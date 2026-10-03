import { Check, Keyboard, Lock, Tv } from 'lucide-react';
import { seatLabel, type StationStatusRow } from '@lab/shared';
import { cn } from '@/lib/utils';
import { SEAT_STATES, type Lifecycle } from '../seat-states';
import { TOTAL_SEATS } from '../use-lab-status';

function seatClasses(lifecycle: Lifecycle | undefined, isTeacher: boolean, isSelected: boolean): string {
  const base =
    'group relative flex aspect-square select-none flex-col items-center justify-center rounded-control border p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed';

  if (isSelected) return cn(base, 'border-brand bg-brand text-brand-ink', isTeacher && 'border-2');

  const colors: Record<Lifecycle, string> = {
    UNCLAIMED: 'border-dashed border-input bg-transparent text-muted-foreground',
    OFFLINE: 'border-hairline bg-muted/60 text-muted-foreground/70 hover:bg-muted',
    READY: 'border-status-info/40 bg-status-info/5 text-foreground hover:bg-status-info/10',
    ACTIVE: 'border-status-online/50 bg-status-online/10 font-semibold text-foreground hover:bg-status-online/15',
    JOINING: 'border-status-pending/50 bg-status-pending/10 text-foreground hover:bg-status-pending/15',
    LOCKED: 'border-brand/40 bg-brand-soft font-semibold text-brand hover:bg-brand-soft/70',
    ERROR: 'border-status-offline/60 bg-status-offline/10 text-status-offline hover:bg-status-offline/15',
  };

  return cn(base, lifecycle ? colors[lifecycle] : colors.UNCLAIMED, isTeacher && 'border-2 border-brand');
}

function tooltip(station: StationStatusRow | undefined, isAdmin: boolean): string {
  if (!station) return 'No station registered for this seat';
  return (
    `${station.hostname}${station.ip ? ` (${station.ip})` : ''} · ${station.appVersion ?? 'unknown version'}` +
    (station.currentUser ? ` · ${station.currentUser.fullName} (${station.currentUser.serviceNumber})` : ' · no student seated') +
    (isAdmin && station.liveClass ? ` · ${station.liveClass.title} (${station.liveClass.teacherName})` : '')
  );
}

function Badges({ station, selected }: { station: StationStatusRow; selected: boolean }) {
  return (
    <>
      {station.lock && (
        <span className="absolute left-1.5 top-1.5" title={station.lock.screen ? 'Screen locked' : 'Keyboard & mouse locked'}>
          {station.lock.screen ? <Lock className="h-2.5 w-2.5" /> : <Keyboard className="h-2.5 w-2.5" />}
        </span>
      )}
      {station.screenSharing && !selected && (
        <span className="absolute right-1.5 top-1.5" title="Sharing to class">
          <Tv className="h-2.5 w-2.5" />
        </span>
      )}
      {selected && <Check className="absolute right-1.5 top-1.5 h-3 w-3" aria-hidden />}
    </>
  );
}

export function SeatLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-[4px] border-2 border-brand" />
        Teacher
      </span>
      {SEAT_STATES.filter((s) => s.key !== 'NONE').map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className={cn('h-2 w-2 rounded-full', s.dot)} />
          {s.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <Lock className="h-3 w-3" /> Screen lock
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Keyboard className="h-3 w-3" /> Input lock
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Tv className="h-3 w-3" /> Sharing
      </span>
    </div>
  );
}

/**
 * The 41-seat grid plus any registered-but-unnumbered stations. Click toggles
 * a seat; Shift+click extends from the last clicked seat.
 */
export function SeatGrid({
  bySeat,
  unclaimed,
  selected,
  isAdmin,
  onSeatClick,
}: {
  bySeat: Map<number | null, StationStatusRow>;
  unclaimed: StationStatusRow[];
  selected: Set<string>;
  isAdmin: boolean;
  onSeatClick: (stationId: string, seatNo: number | null, shift: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(64px,1fr))] sm:gap-2">
      {Array.from({ length: TOTAL_SEATS }, (_, i) => i + 1).map((seatNo) => {
        const station = bySeat.get(seatNo);
        const isTeacher = seatNo === 1;
        const isSelected = !!station && selected.has(station.stationId);
        return (
          <button
            key={seatNo}
            type="button"
            disabled={!station}
            aria-pressed={isSelected}
            aria-label={`Seat ${seatLabel(seatNo)}${station?.currentUser ? `, ${station.currentUser.fullName}` : ''}`}
            onClick={(e) => station && onSeatClick(station.stationId, seatNo, e.shiftKey)}
            className={seatClasses(station?.lifecycle, isTeacher, isSelected)}
            title={tooltip(station, isAdmin)}
          >
            <span className="text-xs font-semibold leading-none">{seatLabel(seatNo)}</span>
            {station?.currentUser && (
              <span className="mt-1 max-w-full truncate px-1 text-[10px] font-medium leading-tight opacity-80">
                {station.currentUser.fullName.split(' ')[0]}
              </span>
            )}
            {/* The PC's own name, so it's obvious which physical machine holds this seat. */}
            {station && (
              <span className="mt-0.5 max-w-full truncate px-1 font-mono text-[9px] leading-tight opacity-60">{station.hostname}</span>
            )}
            {station && <Badges station={station} selected={isSelected} />}
          </button>
        );
      })}

      {unclaimed.map((station) => {
        const isSelected = selected.has(station.stationId);
        return (
          <button
            key={station.stationId}
            type="button"
            aria-pressed={isSelected}
            onClick={(e) => onSeatClick(station.stationId, null, e.shiftKey)}
            className={seatClasses(station.lifecycle, false, isSelected)}
            title={`${station.hostname} · ${station.appVersion ?? 'unknown version'} · not assigned a seat`}
          >
            <span className="max-w-full truncate px-1 text-center text-[9px] font-semibold leading-tight">{station.hostname}</span>
            <Badges station={station} selected={isSelected} />
          </button>
        );
      })}
    </div>
  );
}
