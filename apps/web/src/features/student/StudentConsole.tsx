import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Menu } from 'lucide-react';
import { Track } from 'livekit-client';
import type { CommandEnvelope, DesiredStationState, RoundTableFloor } from '@lab/shared';
import { ActivityType, CommandType, seatLabel, shouldHandleDictionaryShortcut } from '@lab/shared';
import {
  BROADCAST_ROOM,
  REMOTE_CONTROL_DATA_TOPIC,
  classBroadcastRoom,
  groupMediaRoom,
  interpretingRoom,
  type ActivityEventPayload,
  type RemoteInputEvent,
} from '@lab/shared/events';
import { StationControlClient } from '../../lib/station-control-client';
import { LiveKitRoomClient, type RemoteTrackHandle } from '../../lib/livekit-client';
import { getLiveKitUrl } from '../../lib/runtime-config';
import { replayInputIfDesktop } from '../../lib/lab-agent';
import { stationApi } from '../../lib/station-api';
import { queryKeys } from '../../lib/query-keys';
import { useStudentSession } from '../../stores/student-session-store';
import { useDictionaryStore } from '../../stores/dictionary-store';
import { ActivityPlayer } from '../activities/registry';
import { AssignmentsPanel } from './AssignmentsPanel';
import { StudyLibraryPanel } from './StudyLibraryPanel';
import { PronunciationPracticePanel } from './PronunciationPracticePanel';
import { MyClassesSection } from './MyClassesSection';
import { JoinLiveClassCard } from './JoinLiveClassCard';
import { StudentSignInScreen } from './StudentSignInScreen';
import { StudentDrawer, SECTION_TITLES, type StudentSection } from './StudentDrawer';
import { StudentHome } from './StudentHome';
import { DictionaryPanel } from '../dictionary/DictionaryPanel';
import { SelectionLookupPopover } from '../dictionary/SelectionLookupPopover';

const textDecoder = new TextDecoder();

/**
 * Which of this station's currently-granted rooms its own mic should
 * publish into (Ser 1 "individual/group/whole-class intercom") — the
 * most specific room this station has a live mic grant for, in priority
 * order: an active group activity's room (but not conference
 * interpreting's — see ConferenceInterpretingActivity), then the class's
 * own broadcast room, then the lab-wide room. Reads only the room NAMES
 * a fresh snapshot grants (never roomsRef, which lags a tick behind
 * during reconcileRooms) — the actual LiveKit connection for whichever
 * name this returns is reconcileRooms' job, not this function's.
 */
function talkRoomFor(snap: DesiredStationState): string | null {
  // Ser 3 Round Table: the server owns the floor, and RoundTablePlayer opens
  // the mic in the group room only while the floor allows it. The header mic
  // must NOT fall through to the class/lab-wide room here — that would let a
  // seat talk over the whole lab from inside a round table.
  if (snap.activity?.type === ActivityType.ROUND_TABLE) return null;
  const grantedRooms = new Set(snap.media.rooms.map((r) => r.room));
  if (snap.sessionId && snap.groupId && snap.activity && snap.activity.type !== ActivityType.CONFERENCE_INTERPRETING) {
    const groupRoom = groupMediaRoom(snap.sessionId, snap.groupId);
    if (grantedRooms.has(groupRoom)) return groupRoom;
  }
  if (snap.liveClass) {
    const classRoom = classBroadcastRoom(snap.liveClass.id);
    if (grantedRooms.has(classRoom)) return classRoom;
  }
  return grantedRooms.has(BROADCAST_ROOM) ? BROADCAST_ROOM : null;
}

/**
 * The actual student-seat experience (Annexure-I Ser 1). This is what
 * runs inside the Electron renderer at every physical seat — the OS-level
 * lock overlay is a separate topmost window the main process draws over
 * this page (design doc §3.1), so this component only needs to render
 * broadcast video/audio and react to activity state, not implement its
 * own lock UI. It also runs standalone in a plain browser (registers its
 * own station identity — see runtime-config's machineGuid comment),
 * which is how this was verified in this environment.
 */
export function StudentConsole() {
  const [snapshot, setSnapshot] = useState<DesiredStationState | null>(null);
  const [identity, setIdentity] = useState<{ stationId: string; seatNo: number } | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [toast, setToast] = useState<{ text: string; severity: 'info' | 'warning' } | null>(null);
  const [stationToken, setStationToken] = useState<string | null>(null);
  // A station can end up watching more than one ScreenShare track at once
  // — the instructor's own broadcast and a teacher-spotlighted student's
  // screen are independent publishers into rooms this station is
  // simultaneously subscribed to (design decision: "show both side by
  // side" rather than one replacing the other). Panes are managed
  // imperatively into this always-mounted container (same escape-hatch
  // pattern as audioContainerRef below and
  // ConferenceInterpretingActivity's own audioContainerRef) rather than
  // rendered from a Map in React state, so a track's own subscribe/
  // unsubscribe events are the only thing that ever attach/detach it —
  // no re-render can cause a livekit track to be re-attached to a fresh
  // element. `screenShareCount` exists purely to toggle the empty-state
  // placeholder; it never drives what's inside the container itself.
  const screenShareContainerRef = useRef<HTMLDivElement>(null);
  const screenShareElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [screenShareCount, setScreenShareCount] = useState(0);
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const roomsRef = useRef<Map<string, LiveKitRoomClient>>(new Map());
  // Which of this station's connected rooms its own mic publishes into —
  // one at a time, never all of roomsRef at once (publishing into every
  // room a student happens to be connected to would double- or
  // triple-voice them to anyone listening on more than one). Priority is
  // decided by talkRoomFor: an active (non-interpreting) group activity's
  // room outranks the class room, which outranks the lab-wide room —
  // interpreting's own room is deliberately excluded, since
  // ConferenceInterpretingActivity owns that room's mic itself. Mirrored
  // in a ref (talkRoomRef/micOnRef) because reconcileRooms and the
  // command-socket handlers below run from the mount-time closure, not a
  // render, so they can't read state directly.
  const talkRoomRef = useRef<string | null>(null);
  const micOnRef = useRef(false);
  const controlRef = useRef<StationControlClient | null>(null);
  const remoteControlRoomRef = useRef<LiveKitRoomClient | null>(null);
  const [remoteControlActive, setRemoteControlActive] = useState(false);
  // This station's OWN spotlight state (Ser 1 "broadcast any student's
  // screen to others") — distinct from screenShareCount above, which is
  // about tracks this station is WATCHING. presentingRoom is non-null only
  // while THIS station is the one being spotlighted to the class.
  const [presentingRoom, setPresentingRoom] = useState<string | null>(null);
  const [presenterMic, setPresenterMic] = useState(false);
  // Ser 3 Round Table — server-owned floor + this seat's group-room client.
  // rtFloorRef is what "drop a stale rt:floor" compares against; it is reset
  // on every socket (re)connect so the authoritative hello snapshot is never
  // discarded as stale (e.g. after a server restart).
  const [rtFloor, setRtFloor] = useState<RoundTableFloor | null>(null);
  const rtFloorRef = useRef<RoundTableFloor | null>(null);
  const rtClientRef = useRef<LiveKitRoomClient | null>(null);
  const [rtClient, setRtClient] = useState<LiveKitRoomClient | null>(null);
  const [rtSpeakers, setRtSpeakers] = useState<Set<string>>(new Set());
  const [rtMicPermitted, setRtMicPermitted] = useState(false);
  const [rtError, setRtError] = useState<string | null>(null);
  const rtErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastActivityEvent, setLastActivityEvent] = useState<(ActivityEventPayload & { fromStationId: string }) | null>(null);
  // Ser 8 (Phase 5): the interpreting room's tracks are deliberately NOT
  // auto-attached like every other room's mic tracks (see
  // ConferenceInterpretingActivity's doc comment) — they're handed to
  // that component instead, keyed by LiveKit participant identity.
  const interpretingClientRef = useRef<LiveKitRoomClient | null>(null);
  const [interpretingTracks, setInterpretingTracks] = useState<Map<string, RemoteTrackHandle>>(new Map());
  const student = useStudentSession((s) => s.student);
  const staleClaimCheckedRef = useRef(false);
  const queryClient = useQueryClient();
  // Which drawer section a signed-in student is looking at. Every section
  // stays MOUNTED and is only hidden (see the render below) — an exercise
  // in progress lives in its panel's own state, and the screen-share/audio
  // containers must never move or unmount (see router.tsx's doc comment).
  const [section, setSection] = useState<StudentSection>('home');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const seatText = identity ? `System ${seatLabel(identity.seatNo)}` : null;
  const studentId = student?.id ?? null;
  const activityInstanceId = snapshot?.activity?.instanceId ?? null;
  // Offline dictionary (SPEC-offline-dictionary.md §7) — absent on an
  // older server's snapshot means "not restricted" (see
  // emptyDesiredState's own default), matching the server's own
  // fail-open-on-the-client / fail-closed-on-the-server split: the real
  // gate is DictionaryAccessGuard, this is only what hides the panel.
  const dictionaryEnabled = snapshot?.dictionaryEnabled ?? true;

  useEffect(() => {
    const control = new StationControlClient({
      onSnapshot: (snap) => {
        setSnapshot(snap);
        if (snap.roundTable) applyRoundTableFloor(snap.roundTable.floor);
        else clearRoundTableFloor();
        void reconcileRooms(snap);
      },
      onConnect: () => {
        rtFloorRef.current = null;
      },
      onRoundTableFloor: (floor) => applyRoundTableFloor(floor),
      onRoundTableError: (e) => showRoundTableError(e.message),
      onIdentity: (id) => setIdentity(id),
      onCommand: (envelope) => handleCommand(envelope, control),
      onLockHeartbeat: () => {
        // The failsafe lease renewal itself (design doc §3.3) — the
        // Electron main process's LockOverlayManager is what actually
        // acts on this; this page has nothing to renew.
      },
      onRemoteControlStart: (payload) => void startRemoteControl(payload),
      onRemoteControlStop: () => void stopRemoteControl(),
      onScreenShareSet: (payload) => void applyScreenShare(payload),
      onActivityEvent: (payload) => setLastActivityEvent(payload),
      onToken: (token) => setStationToken(token),
      onSignedOut: () => useStudentSession.getState().clear(),
    });
    controlRef.current = control;
    control.connect();

    return () => {
      control.disconnect();
      for (const room of roomsRef.current.values()) void room.disconnect();
      roomsRef.current.clear();
      void remoteControlRoomRef.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A fresh boot with no local student session (sessionStorage cleared, or
  // a different seat) means nobody has proven their identity to THIS
  // renderer yet — but the server may still remember a claim from a
  // previous occupant who didn't sign out cleanly (crash, force-quit).
  // Before real credentials existed, that stale claim was silently
  // recoverable (see AssignmentsPanel's old recovery-on-refresh comment);
  // now that sign-in needs a real password, silently resuming a previous
  // student's identity would be a security hole rather than a
  // convenience, so clear it instead of recovering it.
  useEffect(() => {
    if (!stationToken || staleClaimCheckedRef.current) return;
    staleClaimCheckedRef.current = true;
    if (!useStudentSession.getState().student) {
      void stationApi.release(stationToken).catch(() => void 0);
    }
  }, [stationToken]);

  // A seat is shared hardware, so nothing one student's queries cached may
  // reach the next. Cleared on the way OUT (previous id -> anything else),
  // never on the way in: on sign-in the new student's panels have already
  // subscribed by the time a parent effect runs, and removing a live query
  // then would orphan it. Also puts a fresh sign-in on Home — or straight
  // on the class view if a broadcast/activity is already running.
  const prevStudentIdRef = useRef<string | null>(studentId);
  useEffect(() => {
    if (prevStudentIdRef.current !== null && prevStudentIdRef.current !== studentId) {
      queryClient.removeQueries({ queryKey: queryKeys.myClasses });
      queryClient.removeQueries({ queryKey: queryKeys.myEnrollments });
      queryClient.removeQueries({ queryKey: queryKeys.studentAssignments });
      queryClient.removeQueries({ queryKey: queryKeys.studentStudyLibrary });
      queryClient.removeQueries({ queryKey: queryKeys.classHistoryAll });
      // Recent lookups are session-local (spec §6.2) — the same shared-
      // hardware boundary as the query-cache clears above.
      useDictionaryStore.getState().resetForNewStudent();
    }
    prevStudentIdRef.current = studentId;
    setSection(studentId && (screenShareCount > 0 || activityInstanceId) ? 'class' : 'home');
    setDrawerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  // Ctrl+D opens the dictionary panel, focused on its search box (spec
  // §6.1) — a plain renderer-level listener, NOT Electron's globalShortcut
  // (which is OS-wide and would swallow the browser's own Ctrl+D in dev).
  // shouldHandleDictionaryShortcut is what keeps this from firing while a
  // typed-answer activity's textarea has focus (spec §6.3).
  useEffect(() => {
    if (!student) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (!shouldHandleDictionaryShortcut(event, event.target as HTMLElement | null, dictionaryEnabled)) return;
      event.preventDefault();
      useDictionaryStore.getState().setOpen(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [student, dictionaryEnabled]);

  // The teacher starts sharing their screen or launches an activity while a
  // student is on another page: bring them to the class view so they see it
  // right away. Only the START of something switches (0 -> some shares, or
  // a new activity instance) — never a steady state, so a student who
  // deliberately navigates away mid-broadcast is left alone.
  const prevShareCountRef = useRef(screenShareCount);
  const prevActivityIdRef = useRef<string | null>(activityInstanceId);
  useEffect(() => {
    const shareStarted = prevShareCountRef.current === 0 && screenShareCount > 0;
    const activityStarted = activityInstanceId !== null && activityInstanceId !== prevActivityIdRef.current;
    prevShareCountRef.current = screenShareCount;
    prevActivityIdRef.current = activityInstanceId;
    if (studentId && (shareStarted || activityStarted)) {
      setSection('class');
      setDrawerOpen(false);
    }
  }, [screenShareCount, activityInstanceId, studentId]);

  /** Ends this student's seat session (moved here from AssignmentsPanel now
   * that sign-out lives in the drawer). The local session is only cleared
   * once the server has released the seat, so a failed release leaves the
   * student signed in with a visible warning rather than half signed out. */
  async function signOut(): Promise<void> {
    const control = controlRef.current;
    if (!control || signingOut) return;
    setSigningOut(true);
    try {
      await stationApi.release(control.getToken());
      useStudentSession.getState().clear();
      setDrawerOpen(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[student] sign-out failed', err);
      showToast("Couldn't sign you out. Check the connection and try again.", 'warning');
    } finally {
      setSigningOut(false);
    }
  }

  /** The teacher started remote control (design doc §3.4): publish this
   * seat's screen into the dedicated ctrl:<stationId> room (only the
   * teacher holds a token for it) and start replaying whatever input
   * arrives on the data channel. Replay itself happens in Electron's main
   * process — see lab-agent.ts's comment on why it can't happen here. */
  async function startRemoteControl(payload: { room: string; token: string }): Promise<void> {
    const client = new LiveKitRoomClient({
      onDataReceived: (data, topic) => {
        if (topic !== REMOTE_CONTROL_DATA_TOPIC) return;
        try {
          const event = JSON.parse(textDecoder.decode(data)) as RemoteInputEvent;
          replayInputIfDesktop(event);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[student] failed to parse remote-control input event', err);
        }
      },
    });
    remoteControlRoomRef.current = client;
    await client.connect(getLiveKitUrl(), payload.token);
    await client.setScreenShareEnabled(true);
    setRemoteControlActive(true);
  }

  async function stopRemoteControl(): Promise<void> {
    await remoteControlRoomRef.current?.disconnect();
    remoteControlRoomRef.current = null;
    setRemoteControlActive(false);
  }

  /** Teacher spotlight (Ser 1 "broadcast any student's screen to others").
   * Unlike remote-control:start this carries no token — this station is
   * already connected to `room` with a live grant (it's the class's own
   * broadcast room), and the server has already upgraded this station's
   * LiveKit publish permissions in place before sending this event (see
   * ControlController.promoteScreen). If for some reason this station
   * isn't connected to `room` yet, there's nothing to publish into — the
   * next snapshot-driven reconcileRooms will connect it and the server's
   * screen-share:set already landed, so no retry is needed here. */
  async function applyScreenShare(payload: { room: string; screen: boolean; mic: boolean }): Promise<void> {
    const client = roomsRef.current.get(payload.room);
    if (!client) return;
    // Screen capture itself never grabs system audio here (see
    // setScreenShareEnabled's captureAudio doc comment) — a spotlighted
    // seat is also hearing the teacher and classmates through this same
    // console, and looping that back to the class would echo. The
    // presenter's voice is this explicit mic grant instead.
    await client.setScreenShareEnabled(payload.screen);
    await client.setMicrophoneEnabled(payload.mic);
    setPresentingRoom(payload.screen ? payload.room : null);
    setPresenterMic(payload.mic);
    // Keep the header's own Mute/Unmute button truthful when the teacher
    // is the one driving this room's mic (only meaningful when this is
    // also the room toggleMic would publish into).
    if (payload.room === talkRoomRef.current) {
      setMicOn(payload.mic);
      micOnRef.current = payload.mic;
    }
  }

  /** Keeps the highest-seq floor: a lower seq than the one shown is a late,
   * out-of-order update and is dropped (spec 8.4). Equal seq is idempotent. */
  function applyRoundTableFloor(floor: RoundTableFloor): void {
    const shown = rtFloorRef.current;
    if (shown && shown.groupId === floor.groupId && floor.seq < shown.seq) return;
    rtFloorRef.current = floor;
    setRtFloor(floor);
  }

  function clearRoundTableFloor(): void {
    rtFloorRef.current = null;
    setRtFloor(null);
  }

  function showRoundTableError(message: string): void {
    setRtError(message);
    if (rtErrorTimerRef.current) clearTimeout(rtErrorTimerRef.current);
    rtErrorTimerRef.current = setTimeout(() => setRtError(null), 5000);
  }

  function showToast(text: string, severity: 'info' | 'warning'): void {
    setToast({ text, severity });
    setTimeout(() => setToast(null), 6000);
  }

  function handleCommand(envelope: CommandEnvelope, control: StationControlClient): void {
    if (envelope.type === CommandType.MESSAGE) {
      const payload = envelope.payload as { text: string; severity: 'info' | 'warning' };
      showToast(payload.text, payload.severity);
    }
    // SHUTDOWN/RESTART/LAUNCH_PROGRAM/OPEN_URL have no meaning in a
    // browser tab — those only apply to the real Electron client
    // (apps/desktop/src/main/command-handler.ts). Ack as ignored rather
    // than silently dropping, so the teacher's outbox doesn't wait
    // forever for a browser-only test station.
    control.ackCommand({
      commandId: envelope.id,
      status: envelope.type === CommandType.MESSAGE ? 'applied' : 'ignored',
      appliedAt: Date.now(),
    });
  }

  async function reconcileRooms(snap: DesiredStationState): Promise<void> {
    const livekitUrl = getLiveKitUrl();
    const wantedRoomNames = new Set(snap.media.rooms.map((r) => r.room));
    const interpRoomName = snap.sessionId ? interpretingRoom(snap.sessionId) : null;
    const rtRoomName =
      snap.sessionId && snap.groupId && snap.activity?.type === ActivityType.ROUND_TABLE
        ? groupMediaRoom(snap.sessionId, snap.groupId)
        : null;

    // Leave rooms no longer in the snapshot (e.g. session ended).
    for (const [name, client] of roomsRef.current) {
      if (!wantedRoomNames.has(name)) {
        void client.disconnect();
        roomsRef.current.delete(name);
        if (client === rtClientRef.current) {
          rtClientRef.current = null;
          setRtClient(null);
          setRtSpeakers(new Set());
          setRtMicPermitted(false);
        }
      }
    }
    if (interpRoomName && !wantedRoomNames.has(interpRoomName) && interpretingClientRef.current) {
      interpretingClientRef.current = null;
      setInterpretingTracks(new Map());
    }

    for (const grant of snap.media.rooms) {
      if (roomsRef.current.has(grant.room)) continue; // already connected with a live token
      const isInterpreting = grant.room === interpRoomName;
      const isRoundTable = grant.room === rtRoomName;
      const rtRef = { sessionId: snap.sessionId ?? '', groupId: snap.groupId ?? '' };
      const client: LiveKitRoomClient = isInterpreting
        ? new LiveKitRoomClient({
            onTrackSubscribed: (handle) => setInterpretingTracks((prev) => new Map(prev).set(handle.participantIdentity, handle)),
            onTrackUnsubscribed: (handle) =>
              setInterpretingTracks((prev) => {
                const next = new Map(prev);
                next.delete(handle.participantIdentity);
                return next;
              }),
          })
        : isRoundTable
          ? new LiveKitRoomClient({
              onTrackSubscribed: (handle) => attachTrack(handle),
              onTrackUnsubscribed: (handle) => detachTrack(handle),
              // The server grants/revokes this seat's mic in place as the floor moves;
              // reflect it quietly (no error toast — see RoundTablePlayer).
              onLocalPermissionsChanged: (can) => setRtMicPermitted(can),
              onActiveSpeakersChanged: (ids) => setRtSpeakers(new Set(ids)),
              onReconnected: () => controlRef.current?.rtSync(rtRef),
            })
          : new LiveKitRoomClient({
              onTrackSubscribed: (handle) => attachTrack(handle),
              onTrackUnsubscribed: (handle) => detachTrack(handle),
            });
      roomsRef.current.set(grant.room, client);
      if (isInterpreting) interpretingClientRef.current = client;
      if (isRoundTable) {
        rtClientRef.current = client;
        setRtClient(client);
      }
      try {
        await client.connect(livekitUrl, grant.token);
        if (isRoundTable) {
          // Tell the server we are in the room: it applies this seat's publish
          // right now (the token itself always starts muted).
          setRtMicPermitted(client.canPublishMic);
          controlRef.current?.rtSync(rtRef);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[student] failed to connect to LiveKit room ${grant.room}`, err);
      }
    }

    // Move the live mic to whichever room now outranks the others (e.g.
    // an activity just started, or ended) — never leave it publishing
    // into a room this station no longer has the priority reason to talk
    // in.
    const nextTalkRoom = talkRoomFor(snap);
    if (nextTalkRoom !== talkRoomRef.current) {
      const prevRoom = talkRoomRef.current;
      talkRoomRef.current = nextTalkRoom;
      if (micOnRef.current) {
        try {
          await roomsRef.current.get(prevRoom ?? '')?.setMicrophoneEnabled(false);
          if (nextTalkRoom) {
            await roomsRef.current.get(nextTalkRoom)?.setMicrophoneEnabled(true);
          } else {
            micOnRef.current = false;
            setMicOn(false);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[student] failed to move microphone to the new talk room', err);
        }
      }
    }
  }

  function attachTrack(handle: RemoteTrackHandle): void {
    if (handle.source === Track.Source.ScreenShare) {
      const container = screenShareContainerRef.current;
      if (!container) return;
      // Identity convention: MediaService.mintToken always builds
      // `st:${stationId}`, and every teacher-side connection to this room
      // (BroadcastPanel's own publish, ControlController.promoteScreen's
      // hidden preview token) passes a stationId of the form `teacher:<sub>`
      // — a real station's stationId is a DB cuid and can never collide
      // with that prefix.
      const isInstructor = handle.participantIdentity.startsWith('st:teacher:');
      const videoEl = handle.track.attach() as HTMLVideoElement;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.className = 'h-full w-full rounded-lg bg-black object-contain';
      const label = document.createElement('span');
      label.className = 'absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white';
      label.textContent = isInstructor ? 'Instructor' : handle.participantName;
      const wrapper = document.createElement('div');
      wrapper.className = 'relative aspect-video overflow-hidden rounded-lg bg-black';
      wrapper.appendChild(videoEl);
      wrapper.appendChild(label);
      container.appendChild(wrapper);
      screenShareElsRef.current.set(handle.participantIdentity, wrapper);
      setScreenShareCount(screenShareElsRef.current.size);
    } else if (
      (handle.source === Track.Source.Microphone || handle.source === Track.Source.ScreenShareAudio) &&
      audioContainerRef.current
    ) {
      const el = handle.track.attach();
      el.dataset.participant = handle.participantIdentity;
      audioContainerRef.current.appendChild(el);
    }
  }

  function detachTrack(handle: RemoteTrackHandle): void {
    handle.track.detach().forEach((el) => el.remove());
    if (handle.source === Track.Source.ScreenShare) {
      screenShareElsRef.current.get(handle.participantIdentity)?.remove();
      screenShareElsRef.current.delete(handle.participantIdentity);
      setScreenShareCount(screenShareElsRef.current.size);
    }
  }

  /** Publishes into exactly one room — talkRoomRef (see talkRoomFor) —
   * never every room this station happens to be connected to; looping
   * over all of roomsRef would also republish into the conference
   * interpreting room, fighting ConferenceInterpretingActivity's own mic
   * control there. */
  async function toggleMic(): Promise<void> {
    const room = talkRoomRef.current;
    const client = room ? roomsRef.current.get(room) : null;
    if (!client) {
      showToast('Not connected to class audio yet.', 'warning');
      return;
    }
    const next = !micOn;
    try {
      await client.setMicrophoneEnabled(next);
      setMicOn(next);
      micOnRef.current = next;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[student] failed to toggle microphone', err);
      showToast("Couldn't turn on the microphone. Check that one is connected and that Windows allows desktop apps to use it.", 'warning');
    }
  }

  /** Visibility class for a full-width section pane. Panes stay mounted and
   * are only hidden, so a section's own state (an exercise mid-attempt, a
   * half-typed word) survives switching away and back. */
  const paneClass = (s: StudentSection): string =>
    `flex w-full flex-col items-center gap-4 ${section === s ? '' : 'hidden'}`;
  // Signed in: the class view is a drawer section like any other. Signed
  // out there is no drawer, so the live view simply shows whenever there is
  // something live to see (a shared screen or a running activity).
  const classVisible = student ? section === 'class' : screenShareCount > 0 || !!snapshot?.activity;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {student && (
            <>
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Menu className="h-5 w-5" />
              </button>
              <span className="text-base font-semibold">{SECTION_TITLES[section]}</span>
              <span className="h-5 w-px bg-border" />
            </>
          )}
          <div>
            <h1 className="text-sm font-semibold text-muted-foreground">{seatText ?? 'Registering…'}</h1>
            {snapshot?.liveClass && (
              <p className="text-xs text-muted-foreground">
                Class: {snapshot.liveClass.title} · {snapshot.liveClass.teacherName}
              </p>
            )}
            {snapshot?.activity && <p className="text-xs text-muted-foreground">{snapshot.activity.type}</p>}
          </div>
        </div>
        {remoteControlActive && snapshot?.monitoringIndicator && (
          <span className="flex items-center gap-1.5 rounded-full bg-red-900 px-3 py-1 text-xs font-medium text-red-100">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
            Instructor has taken control
          </span>
        )}
        {presentingRoom && (
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-900 px-3 py-1 text-xs font-medium text-emerald-100">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Your screen is being shared with the class{presenterMic ? ' · mic is on' : ''}
          </span>
        )}
        <button
          type="button"
          onClick={() => void toggleMic()}
          disabled={snapshot?.activity?.type === ActivityType.ROUND_TABLE}
          title={snapshot?.activity?.type === ActivityType.ROUND_TABLE ? 'Your microphone follows the discussion floor' : undefined}
          className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${micOn ? 'bg-red-700 text-white' : 'bg-secondary text-secondary-foreground'}`}
        >
          {snapshot?.activity?.type === ActivityType.ROUND_TABLE ? 'Mic: by floor' : micOn ? 'Mute Mic' : 'Unmute Mic'}
        </button>
      </header>

      {student && (
        <StudentDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          section={section}
          onSelect={setSection}
          student={student}
          seatText={seatText}
          inLiveClass={!!snapshot?.liveClass}
          onOpenDictionary={() => useDictionaryStore.getState().setOpen(true)}
          onSignOut={() => void signOut()}
          signingOut={signingOut}
        />
      )}

      {toast && (
        <div className={`m-4 rounded-md px-4 py-2 text-sm ${toast.severity === 'warning' ? 'bg-amber-900 text-amber-100' : 'bg-sky-900 text-sky-100'}`}>
          {toast.text}
        </div>
      )}

      {/* Row below the header: the main scroll area plus the docked
          dictionary panel (spec §6.3 — a side panel, not a modal, so it
          sits beside this content rather than over it). `min-h-0` lets
          <main>'s own overflow-y-auto actually take effect inside a flex
          child, which a flex item's default min-height:auto would otherwise
          prevent. */}
      <div className="flex flex-1 min-h-0">
      <main className="flex flex-1 flex-col items-center gap-4 overflow-y-auto p-6">
        {/* The live/class view. ALWAYS mounted (only hidden) — LiveKit
            attaches broadcast/remote-control tracks to the containers in
            here regardless of sign-in state or which section is showing, and
            hiding them was the exact regression router.tsx's doc comment
            records for gating /student itself. Everything conditional inside
            keeps a fixed slot, so screenShareContainerRef's <div> is never
            unmounted or re-parented and panes attached before a re-render
            never get orphaned. */}
        <section data-section="class" className={`flex w-full flex-col items-center gap-4 ${classVisible ? '' : 'hidden'}`}>
          {/* Sign-in never asks for a class, so a seat with no live class
              yet attaches to the teacher's one here. Gated on a real
              snapshot so it doesn't flash before the first push arrives. */}
          {student && snapshot && !snapshot.liveClass && <JoinLiveClassCard stationToken={stationToken} />}
          {student && snapshot?.liveClass && (
            <div className="w-full max-w-2xl rounded-lg border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm">
              <span className="font-medium">You're in {snapshot.liveClass.title}</span>
              <span className="text-muted-foreground"> · {snapshot.liveClass.teacherName}</span>
            </div>
          )}

          <div className="w-full max-h-[60vh]">
            <div
              ref={screenShareContainerRef}
              className={
                screenShareCount === 0
                  ? 'hidden'
                  : 'grid w-full gap-3 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]'
              }
            />
            {screenShareCount === 0 && student && snapshot?.liveClass && (
              <div className="flex h-48 w-full items-center justify-center rounded-lg bg-black text-sm text-slate-600">
                No screen is being shared right now
              </div>
            )}
          </div>
          {snapshot?.activity && identity && snapshot.groupId && snapshot.sessionId && controlRef.current && (
            <div className="w-full max-w-2xl">
              <ActivityPlayer
                control={controlRef.current}
                sessionId={snapshot.sessionId}
                groupId={snapshot.groupId}
                stationId={identity.stationId}
                role={snapshot.role}
                activity={snapshot.activity}
                lastActivityEvent={lastActivityEvent}
                interpretingRoomClient={interpretingClientRef.current}
                interpretingTracks={interpretingTracks}
                roundTable={
                  snapshot.roundTable && rtFloor
                    ? { view: snapshot.roundTable, floor: rtFloor, client: rtClient, speakers: rtSpeakers, micPermitted: rtMicPermitted, error: rtError }
                    : null
                }
              />
            </div>
          )}
        </section>

        {/* A live teacher-run activity is station/group-scoped, not
            personal — classroom-control features are deliberately
            identity-free (see StationsService.claim's doc comment), so
            they render above regardless of sign-in state. Everything
            personal is behind a real student credential: this login page
            replaces the old passwordless "type your service number" card. */}
        {!snapshot?.activity && !student && (
          <StudentSignInScreen
            stationToken={stationToken}
            defaultSystemNumber={identity && identity.seatNo > 1 ? identity.seatNo - 1 : null}
            seatText={seatText}
          />
        )}

        {student && controlRef.current && (
          <>
            <div data-section="home" className={paneClass('home')}>
              <StudentHome
                control={controlRef.current}
                student={student}
                seatText={seatText}
                liveClass={snapshot?.liveClass ?? null}
                active={section === 'home'}
                onNavigate={setSection}
              />
            </div>

            {/* The student's classes (batch code + key to join one — a student
                with no class lands on an empty state, not an error) and,
                opened, what they did in each. */}
            <div data-section="classes" className={paneClass('classes')}>
              <MyClassesSection
                control={controlRef.current}
                student={student}
                active={section === 'classes'}
                onOpenAssignments={() => setSection('assignments')}
              />
            </div>

            {/* Self-paced assessment (Ser 10) — independent of live session
                state, matching Ser 1's "self-study even when teacher not
                present". */}
            <div data-section="assignments" className={paneClass('assignments')}>
              <AssignmentsPanel control={controlRef.current} />
            </div>

            {/* Ser 1 self-study library (Phase 4) — same "teacher absent"
                posture as assignments, but browsing a teacher-curated
                StudyModule rather than a targeted Assignment. */}
            <div data-section="study" className={paneClass('study')}>
              <StudyLibraryPanel control={controlRef.current} active={section === 'study'} />
            </div>

            {/* Ser 7 self-practice: hear any word, record yourself, compare —
                plus the teacher's pronunciation exercises. Open practice like
                the study library; the graded pronunciation TEST arrives in
                Assignments instead. */}
            <div data-section="pronunciation" className={paneClass('pronunciation')}>
              <PronunciationPracticePanel control={controlRef.current} />
            </div>
          </>
        )}
      </main>
      {student && controlRef.current && <DictionaryPanel control={controlRef.current} dictionaryEnabled={dictionaryEnabled} />}
      </div>
      {student && <SelectionLookupPopover dictionaryEnabled={dictionaryEnabled} />}
      <div ref={audioContainerRef} className="hidden" />
    </div>
  );
}
