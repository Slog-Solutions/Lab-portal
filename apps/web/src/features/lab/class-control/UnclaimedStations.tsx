import { useEffect, useState } from 'react';
import { seatLabel, type StationStatusRow } from '@lab/shared';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';

function UnclaimedStationRow({
  station,
  freeSeats,
  busy,
  onAssign,
}: {
  station: StationStatusRow;
  freeSeats: number[];
  busy: boolean;
  onAssign: (stationId: string, seatNo: number) => Promise<void>;
}) {
  const [seatNo, setSeatNo] = useState<number | undefined>(freeSeats[0]);

  useEffect(() => {
    if (seatNo === undefined || !freeSeats.includes(seatNo)) setSeatNo(freeSeats[0]);
  }, [freeSeats]);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs text-foreground">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{station.hostname}</span>
        <span className="text-muted-foreground">{station.appVersion ?? 'unknown version'}</span>
      </div>
      <div className="flex items-center gap-2">
        <NativeSelect
          compact
          value={seatNo ?? ''}
          onChange={(e) => setSeatNo(Number(e.target.value))}
          disabled={busy || freeSeats.length === 0}
          aria-label={`Seat for ${station.hostname}`}
        >
          {freeSeats.map((n) => (
            <option key={n} value={n}>
              Seat {seatLabel(n)}
            </option>
          ))}
        </NativeSelect>
        <Button size="sm" disabled={busy || seatNo === undefined} onClick={() => seatNo !== undefined && void onAssign(station.stationId, seatNo)}>
          {busy ? 'Assigning…' : 'Assign'}
        </Button>
      </div>
    </li>
  );
}

/** Admin-only: stations that connected but have no seat number yet. */
export function UnclaimedStationsPanel({
  stations,
  freeSeats,
  assigningId,
  onAssign,
}: {
  stations: StationStatusRow[];
  freeSeats: number[];
  assigningId: string | null;
  onAssign: (stationId: string, seatNo: number) => Promise<void>;
}) {
  if (stations.length === 0) return null;
  return (
    <div className="mt-5 rounded-control border border-status-pending/30 bg-status-pending/5 p-4">
      <h3 className="text-sm font-semibold text-foreground">
        {stations.length} station{stations.length === 1 ? '' : 's'} waiting for seat assignment
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Connected and registered, but not yet numbered — assign a seat to map it into the grid.</p>
      <ul className="mt-3 divide-y divide-hairline rounded-control border border-hairline bg-card">
        {stations.map((station) => (
          <UnclaimedStationRow
            key={station.stationId}
            station={station}
            freeSeats={freeSeats}
            busy={assigningId === station.stationId}
            onAssign={onAssign}
          />
        ))}
      </ul>
    </div>
  );
}
