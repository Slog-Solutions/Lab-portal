import { useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import type { CommandEnvelope, DesiredStationState } from '@lab/shared';
import { CommandType } from '@lab/shared';
import { REMOTE_CONTROL_DATA_TOPIC, interpretingRoom, type ActivityEventPayload, type RemoteInputEvent } from '@lab/shared/events';
import { StationControlClient } from '../../lib/station-control-client';
import { LiveKitRoomClient, type RemoteTrackHandle } from '../../lib/livekit-client';
import { getLiveKitUrl } from '../../lib/runtime-config';
import { replayInputIfDesktop } from '../../lib/lab-agent';
import { ActivityPlayer } from '../activities/registry';
import { AssignmentsPanel } from './AssignmentsPanel';
import { StudyLibraryPanel } from './StudyLibraryPanel';

const textDecoder = new TextDecoder();

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const roomsRef = useRef<Map<string, LiveKitRoomClient>>(new Map());
  const controlRef = useRef<StationControlClient | null>(null);
  const remoteControlRoomRef = useRef<LiveKitRoomClient | null>(null);
  const [remoteControlActive, setRemoteControlActive] = useState(false);
  const [lastActivityEvent, setLastActivityEvent] = useState<(ActivityEventPayload & { fromStationId: string }) | null>(null);
  // Ser 8 (Phase 5): the interpreting room's tracks are deliberately NOT
  // auto-attached like every other room's mic tracks (see
  // ConferenceInterpretingActivity's doc comment) — they're handed to
  // that component instead, keyed by LiveKit participant identity.
  const interpretingClientRef = useRef<LiveKitRoomClient | null>(null);
  const [interpretingTracks, setInterpretingTracks] = useState<Map<string, RemoteTrackHandle>>(new Map());

  useEffect(() => {
    const control = new StationControlClient({
      onSnapshot: (snap) => {
        setSnapshot(snap);
        void reconcileRooms(snap);
      },
      onIdentity: (id) => setIdentity(id),
      onCommand: (envelope) => handleCommand(envelope, control),
      onLockHeartbeat: () => {
        // The failsafe lease renewal itself (design doc §3.3) — the
        // Electron main process's LockOverlayManager is what actually
        // acts on this; this page has nothing to renew.
      },
      onRemoteControlStart: (payload) => void startRemoteControl(payload),
      onRemoteControlStop: () => void stopRemoteControl(),
      onActivityEvent: (payload) => setLastActivityEvent(payload),
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

  function handleCommand(envelope: CommandEnvelope, control: StationControlClient): void {
    if (envelope.type === CommandType.MESSAGE) {
      const payload = envelope.payload as { text: string; severity: 'info' | 'warning' };
      setToast(payload);
      setTimeout(() => setToast(null), 6000);
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

    // Leave rooms no longer in the snapshot (e.g. session ended).
    for (const [name, client] of roomsRef.current) {
      if (!wantedRoomNames.has(name)) {
        void client.disconnect();
        roomsRef.current.delete(name);
      }
    }
    if (interpRoomName && !wantedRoomNames.has(interpRoomName) && interpretingClientRef.current) {
      interpretingClientRef.current = null;
      setInterpretingTracks(new Map());
    }

    for (const grant of snap.media.rooms) {
      if (roomsRef.current.has(grant.room)) continue; // already connected with a live token
      const isInterpreting = grant.room === interpRoomName;
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
        : new LiveKitRoomClient({
            onTrackSubscribed: (handle) => attachTrack(handle),
            onTrackUnsubscribed: (handle) => detachTrack(handle),
          });
      roomsRef.current.set(grant.room, client);
      if (isInterpreting) interpretingClientRef.current = client;
      try {
        await client.connect(livekitUrl, grant.token);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[student] failed to connect to LiveKit room ${grant.room}`, err);
      }
    }
  }

  function attachTrack(handle: RemoteTrackHandle): void {
    if (handle.source === Track.Source.ScreenShare && videoRef.current) {
      handle.track.attach(videoRef.current);
    } else if (handle.source === Track.Source.Microphone && audioContainerRef.current) {
      const el = handle.track.attach();
      el.dataset.participant = handle.participantIdentity;
      audioContainerRef.current.appendChild(el);
    }
  }

  function detachTrack(handle: RemoteTrackHandle): void {
    handle.track.detach().forEach((el) => el.remove());
  }

  async function toggleMic(): Promise<void> {
    const next = !micOn;
    setMicOn(next);
    for (const client of roomsRef.current.values()) {
      await client.setMicrophoneEnabled(next);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div>
          <h1 className="text-sm font-semibold text-slate-300">
            {identity ? `Seat ${identity.seatNo}` : 'Registering…'}
          </h1>
          {snapshot?.activity && <p className="text-xs text-slate-500">{snapshot.activity.type}</p>}
        </div>
        {remoteControlActive && snapshot?.monitoringIndicator && (
          <span className="flex items-center gap-1.5 rounded-full bg-red-900 px-3 py-1 text-xs font-medium text-red-100">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
            Instructor has taken control
          </span>
        )}
        <button
          type="button"
          onClick={() => void toggleMic()}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${micOn ? 'bg-red-700 text-white' : 'bg-slate-800 text-slate-300'}`}
        >
          {micOn ? 'Mute Mic' : 'Unmute Mic'}
        </button>
      </header>

      {toast && (
        <div className={`m-4 rounded-md px-4 py-2 text-sm ${toast.severity === 'warning' ? 'bg-amber-900 text-amber-100' : 'bg-sky-900 text-sky-100'}`}>
          {toast.text}
        </div>
      )}

      <main className="flex flex-1 flex-col items-center gap-4 p-6">
        <video ref={videoRef} autoPlay playsInline className="max-h-[60vh] w-full rounded-lg bg-black object-contain" />
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
            />
          </div>
        )}

        {/* Self-paced assessment (Ser 10) — independent of live session
            state, matching Ser 1's "self-study even when teacher not
            present". Always available once the station has a token. */}
        {controlRef.current && <AssignmentsPanel control={controlRef.current} />}

        {/* Ser 1 self-study library (Phase 4) — same "teacher absent"
            posture as AssignmentsPanel above, but browsing a
            teacher-curated StudyModule rather than a targeted Assignment. */}
        {controlRef.current && <StudyLibraryPanel control={controlRef.current} />}
      </main>
      <div ref={audioContainerRef} className="hidden" />
    </div>
  );
}
