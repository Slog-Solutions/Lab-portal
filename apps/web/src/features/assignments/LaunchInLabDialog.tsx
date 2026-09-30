import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { StationStatusRow } from '@lab/shared';
import { seatLabel } from '@lab/shared';
import { Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/api-client';
import { batchesApi } from '../../lib/batches-api';
import { timedTestsApi } from '../../lib/timed-tests-api';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

interface Candidate {
  studentId: string;
  stationId: string | null;
  label: string;
  detail?: string;
  disabledReason?: string;
}

/**
 * SPEC-mcq-test-timed-reveal.md §6.1 "Launch in lab" — one call turns a
 * saved test into a live, one-group session over the class's currently
 * signed-in seats. Candidate list follows the same "class roster × status
 * board" shape ClassActivitiesCard already uses for live activities,
 * narrowed here to seats not already busy in another session (the actual
 * gate is server-side — TimedTestsService.launch — this is just so a
 * teacher doesn't pick a seat that's obviously unusable).
 */
export function LaunchInLabDialog({
  open,
  onOpenChange,
  exerciseId,
  defaultBatchId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exerciseId: string;
  defaultBatchId?: string;
}) {
  const navigate = useNavigate();
  const [batchId, setBatchId] = useState(defaultBatchId ?? '');
  const [selected, setSelected] = useState<string[]>([]);

  const { data: myClasses } = useQuery({ queryKey: queryKeys.myClasses, queryFn: batchesApi.mine, enabled: open });
  useEffect(() => {
    if (open && !batchId && myClasses && myClasses.length > 0) setBatchId(defaultBatchId ?? myClasses[0]!.id);
  }, [open, batchId, myClasses, defaultBatchId]);

  const { data: roster } = useQuery({
    queryKey: queryKeys.classStudents(batchId),
    queryFn: () => batchesApi.listStudents(batchId),
    enabled: open && !!batchId,
  });
  const { data: stations } = useQuery({
    queryKey: queryKeys.stationsStatusBoard,
    queryFn: () => apiFetch<StationStatusRow[]>('/control/status-board'),
    refetchInterval: open ? 5_000 : false,
    enabled: open,
  });

  const candidates: Candidate[] = (roster ?? [])
    .filter((s) => s.user.active)
    .map((s) => {
      // Seat 1 is the teacher's own PC — never a student seat.
      const seat = (stations ?? []).find((row) => row.currentUser?.id === s.userId && row.seatNo !== 1);
      if (!seat) return { studentId: s.userId, stationId: null, label: s.user.fullName, disabledReason: 'Not at a PC' };
      if (seat.sessionId) return { studentId: s.userId, stationId: null, label: s.user.fullName, disabledReason: 'Already in another activity' };
      return { studentId: s.userId, stationId: seat.stationId, label: s.user.fullName, detail: `System ${seatLabel(seat.seatNo)}` };
    })
    .sort((a, b) => Number(!a.stationId) - Number(!b.stationId) || a.label.localeCompare(b.label));
  const pickable = candidates.filter((c) => c.stationId);

  const launch = useMutation({
    mutationFn: () => {
      const expectedStudents: Record<string, string> = {};
      for (const c of pickable) {
        if (selected.includes(c.studentId)) expectedStudents[c.stationId!] = c.studentId;
      }
      return timedTestsApi.launch({ exerciseId, batchId, expectedStudents });
    },
    onSuccess: (res) => {
      onOpenChange(false);
      setSelected([]);
      if (res.activityInstanceId) navigate(`/tests/live/${res.activityInstanceId}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !launch.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Launch in lab</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="lil-class">Class</Label>
            <NativeSelect
              id="lil-class"
              value={batchId}
              onChange={(e) => {
                setBatchId(e.target.value);
                setSelected([]);
              }}
              className="w-full"
            >
              {(myClasses ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex items-center justify-between">
            <Label>Students</Label>
            <div className="flex gap-2 text-xs">
              <button type="button" className="text-primary hover:underline" onClick={() => setSelected(pickable.map((c) => c.studentId))}>
                Select all signed in
              </button>
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => setSelected([])}>
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {candidates.length === 0 && <p className="p-2 text-sm text-muted-foreground">No students in this class yet.</p>}
            {candidates.map((c) => (
              <label
                key={c.studentId}
                className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm ${c.stationId ? 'hover:bg-accent' : 'opacity-50'}`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!c.stationId}
                    checked={selected.includes(c.studentId)}
                    onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, c.studentId] : prev.filter((id) => id !== c.studentId)))}
                  />
                  {c.label}
                </span>
                <span className="text-xs text-muted-foreground">{c.detail ?? c.disabledReason}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {selected.length} of {pickable.length} signed-in students selected ({candidates.length - pickable.length} not at a PC right now).
          </p>
          {launch.isError && <p className="text-sm text-destructive">{launch.error instanceof Error ? launch.error.message : 'Could not launch the test'}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={launch.isPending}>
            Cancel
          </Button>
          <Button onClick={() => launch.mutate()} disabled={selected.length === 0 || !batchId || launch.isPending} className="gap-1.5">
            {launch.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {launch.isPending ? 'Launching…' : `Launch to ${selected.length} ${selected.length === 1 ? 'student' : 'students'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
