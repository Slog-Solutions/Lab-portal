import type { ActivityEventPayload } from '@lab/shared/events';
import type { DesiredStationState } from '@lab/shared';
import type { StationControlClient } from '../../lib/station-control-client';
import type { LiveKitRoomClient, RemoteTrackHandle } from '../../lib/livekit-client';
import { RoundTableActivity } from './RoundTableActivity';
import { TelephoneActivity } from './TelephoneActivity';
import { PresentationActivity } from './PresentationActivity';
import { ModelImitationActivity } from './ModelImitationActivity';
import { ConferenceInterpretingActivity } from './ConferenceInterpretingActivity';

export interface ActivityPlayerProps {
  control: StationControlClient;
  sessionId: string;
  groupId: string;
  stationId: string;
  role: string | null;
  activity: NonNullable<DesiredStationState['activity']>;
  lastActivityEvent: (ActivityEventPayload & { fromStationId: string }) | null;
  /** Ser 8 only — StudentConsole's own LiveKit room client + subscribed
   * tracks for the shared interpreting room (see that component's doc
   * comment on why this one room isn't auto-attached like every other). */
  interpretingRoomClient?: LiveKitRoomClient | null;
  interpretingTracks?: Map<string, RemoteTrackHandle>;
}

/**
 * The UI-side counterpart to packages/shared/src/activities' Activity
 * Type Registry — that package deliberately has no React dependency
 * (importable from apps/server too), so component resolution lives here
 * instead (see that package's own doc comment). Four of Annexure-I's
 * activity types are real players as of Phase 2; the rest render a
 * plain "not yet built" notice rather than nothing, so a teacher who
 * assigns one gets an honest signal instead of a blank screen.
 */
export function ActivityPlayer(props: ActivityPlayerProps) {
  const { activity } = props;
  switch (activity.type) {
    case 'ROUND_TABLE':
      return (
        <RoundTableActivity
          control={props.control}
          sessionId={props.sessionId}
          groupId={props.groupId}
          instanceId={activity.instanceId}
          stationId={props.stationId}
          role={props.role}
          config={activity.config as Parameters<typeof RoundTableActivity>[0]['config']}
          lastActivityEvent={props.lastActivityEvent}
        />
      );
    case 'TELEPHONE':
      return (
        <TelephoneActivity
          control={props.control}
          sessionId={props.sessionId}
          instanceId={activity.instanceId}
          stationId={props.stationId}
          config={activity.config as Parameters<typeof TelephoneActivity>[0]['config']}
        />
      );
    case 'PRESENTATION_RECORDING':
      return (
        <PresentationActivity
          control={props.control}
          sessionId={props.sessionId}
          instanceId={activity.instanceId}
          stationId={props.stationId}
          config={activity.config as Parameters<typeof PresentationActivity>[0]['config']}
        />
      );
    case 'MODEL_IMITATION':
      return (
        <ModelImitationActivity
          control={props.control}
          sessionId={props.sessionId}
          instanceId={activity.instanceId}
          stationId={props.stationId}
          config={activity.config as Parameters<typeof ModelImitationActivity>[0]['config']}
        />
      );
    case 'CONFERENCE_INTERPRETING':
      return (
        <ConferenceInterpretingActivity
          control={props.control}
          sessionId={props.sessionId}
          groupId={props.groupId}
          instanceId={activity.instanceId}
          stationId={props.stationId}
          role={props.role}
          config={activity.config as Parameters<typeof ConferenceInterpretingActivity>[0]['config']}
          roomClient={props.interpretingRoomClient ?? null}
          tracks={props.interpretingTracks ?? new Map()}
        />
      );
    default:
      return (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900 p-4 text-sm text-slate-500">
          {activity.type} — no player built yet.
        </div>
      );
  }
}
