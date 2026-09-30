import { useState, type ReactNode } from 'react';
import { MonitorPlay, MousePointerClick, Tv, UserMinus } from 'lucide-react';
import { getActivity, hasActivity } from '@lab/shared/activities';
import { seatLabel, type ActivityType, type StationStatusRow } from '@lab/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SEAT_STATES, stateOf } from '../seat-states';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-xs">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}

function lastSeen(ms: number | null): string {
  if (!ms) return '—';
  const secs = Math.round((Date.now() - ms) / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  return mins < 60 ? `${mins} min ago` : new Date(ms).toLocaleTimeString();
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[4px] border border-input bg-card px-1.5 py-0.5 font-sans text-[10px] font-semibold text-foreground">{children}</kbd>;
}

/**
 * The right-hand inspector next to the seat grid. With one seat selected it
 * is that seat's detail + per-seat controls; with several, a breakdown of the
 * selection; with none, how to use the grid.
 */
export function SeatInspector({
  selected,
  isAdmin,
  onTakeRemoteControl,
  onShareToClass,
  onStopSharing,
  onReleaseStudent,
}: {
  selected: StationStatusRow[];
  isAdmin: boolean;
  onTakeRemoteControl: (stationId: string) => void;
  onShareToClass: (stationId: string) => void;
  onStopSharing: (stationId: string) => void;
  onReleaseStudent: (stationId: string) => Promise<void>;
}) {
  const [releasing, setReleasing] = useState(false);

  if (selected.length === 0) {
    return (
      <div className="rounded-control border border-dashed border-input p-4 text-xs text-muted-foreground">
        <MousePointerClick className="h-5 w-5 text-brand" aria-hidden />
        <p className="mt-2 text-sm font-medium text-foreground">Select seats to control them</p>
        <ul className="mt-3 space-y-2">
          <li>Click a seat to select it — click again to deselect.</li>
          <li>
            <Kbd>Shift</Kbd> + click selects a range of seats.
          </li>
          <li>Use the quick-select buttons above for whole groups.</li>
          <li>
            <Kbd>Esc</Kbd> clears the selection.
          </li>
        </ul>
      </div>
    );
  }

  if (selected.length > 1) {
    const counts = SEAT_STATES.map((s) => ({ ...s, n: selected.filter((r) => r.lifecycle === s.key).length })).filter((s) => s.n > 0);
    const seated = selected.filter((r) => r.currentUser).length;
    return (
      <div className="rounded-control border border-hairline p-4">
        <p className="text-sm font-semibold text-foreground">{selected.length} seats selected</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{seated} with a student signed in</p>
        <ul className="mt-3 space-y-2 border-t border-hairline pt-3">
          {counts.map((s) => (
            <li key={s.key} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className={cn('h-2 w-2 rounded-full', s.dot)} />
                {s.label}
              </span>
              <span className="font-semibold text-foreground tabular-nums">{s.n}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-hairline pt-3 text-xs text-muted-foreground">Use the action bar below to act on all of them at once.</p>
      </div>
    );
  }

  const station = selected[0]!;
  const state = stateOf(station.lifecycle);
  const canTakeControl = station.lifecycle !== 'OFFLINE' && station.lifecycle !== 'UNCLAIMED';
  const canShareScreen = canTakeControl && !!station.currentUser;

  return (
    <div className="rounded-control border border-hairline">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Seat</p>
          <p className="text-xl font-bold leading-tight text-foreground">{station.seatNo ? seatLabel(station.seatNo) : 'Unassigned'}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-pill bg-muted px-2.5 py-1 text-[11px] font-semibold text-foreground">
          <span className={cn('h-2 w-2 rounded-full', state.dot)} />
          {state.label}
        </span>
      </div>

      <div className="px-4 py-3">
        {station.currentUser ? (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream text-xs font-bold text-brand">
              {station.currentUser.fullName
                .split(/\s+/)
                .map((p) => p[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{station.currentUser.fullName}</p>
              <p className="text-xs text-muted-foreground">{station.currentUser.serviceNumber}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No student signed in at this seat.</p>
        )}

        <dl className="mt-2 divide-y divide-hairline">
          <Row label="Computer">
            <span className="font-mono">{station.hostname}</span>
          </Row>
          {station.ip && (
            <Row label="IP address">
              <span className="font-mono">{station.ip}</span>
            </Row>
          )}
          <Row label="Lock">{station.lock ? (station.lock.screen ? 'Screen locked' : 'Keyboard & mouse') : 'None'}</Row>
          <Row label="Activity">
            {station.activityType && hasActivity(station.activityType as ActivityType) ? getActivity(station.activityType as ActivityType).label : 'None'}
          </Row>
          {isAdmin && station.liveClass && <Row label="Class">{station.liveClass.title}</Row>}
          <Row label="App version">{station.appVersion ?? '—'}</Row>
          <Row label="Last seen">{lastSeen(station.lastSeenAt)}</Row>
        </dl>
      </div>

      <div className="space-y-2 border-t border-hairline p-4">
        <Button className="w-full" size="sm" disabled={!canTakeControl} onClick={() => onTakeRemoteControl(station.stationId)}>
          <MonitorPlay />
          Take remote control
        </Button>
        {station.screenSharing ? (
          <Button className="w-full" size="sm" variant="destructive" onClick={() => onStopSharing(station.stationId)}>
            Stop sharing to class
          </Button>
        ) : (
          <Button
            className="w-full"
            size="sm"
            variant="outline"
            disabled={!canShareScreen}
            title={!canShareScreen ? 'Needs an online seat with a student signed in' : undefined}
            onClick={() => onShareToClass(station.stationId)}
          >
            <Tv />
            Share screen to class
          </Button>
        )}
        {station.currentUser && (
          <Button
            className="w-full"
            size="sm"
            variant="ghost"
            disabled={releasing}
            onClick={async () => {
              setReleasing(true);
              try {
                await onReleaseStudent(station.stationId);
              } finally {
                setReleasing(false);
              }
            }}
          >
            <UserMinus />
            {releasing ? 'Releasing…' : 'Release student from seat'}
          </Button>
        )}
      </div>
    </div>
  );
}
