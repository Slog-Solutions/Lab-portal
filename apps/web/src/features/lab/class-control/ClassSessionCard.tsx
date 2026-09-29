import { useState } from 'react';
import { Play, Square } from 'lucide-react';
import type { ClassView } from '../../../lib/classroom-api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from './dialogs';

/** Start / end the live class, with its join code front and centre while live. */
export function ClassSessionCard({
  currentClass,
  isAdmin,
  seatedCount,
  studentSeats,
  onStart,
  onEnd,
}: {
  currentClass: ClassView | null;
  isAdmin: boolean;
  seatedCount: number;
  studentSeats: number;
  onStart: (title: string) => Promise<void>;
  onEnd: () => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const live = currentClass?.state === 'ACTIVE';
  const fill = Math.min(100, Math.round((seatedCount / Math.max(1, studentSeats)) * 100));

  return (
    <section className="flex h-full flex-col rounded-card border border-hairline bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Class session</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{isAdmin ? 'Lab-wide live class' : 'Your live class'}</p>
        </div>
        <Badge variant={live ? 'success' : 'secondary'}>{live ? 'Live' : 'Standby'}</Badge>
      </div>

      {live && currentClass ? (
        <div className="mt-4 flex flex-1 flex-col gap-4">
          <p className="truncate text-base font-semibold text-foreground">{currentClass.title}</p>
          <div className="flex items-center justify-between gap-3 rounded-control bg-brand-soft px-4 py-3">
            <div>
              <p className="text-[11px] font-medium text-brand">Join code</p>
              <p className="font-mono text-2xl font-bold tracking-[0.2em] text-brand">{currentClass.code}</p>
            </div>
            <CopyButton value={currentClass.code} label="class code" />
          </div>
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {currentClass.memberCount} joined · {seatedCount} seated
              </span>
              <span className="font-semibold text-foreground tabular-nums">
                {seatedCount} / {studentSeats}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-pill bg-muted">
              <div className="h-full rounded-pill bg-brand transition-[width]" style={{ width: `${fill}%` }} />
            </div>
          </div>
          <Button variant="outline" className="mt-auto w-full text-destructive hover:text-destructive" onClick={() => setConfirmEnd(true)}>
            <Square />
            End class
          </Button>
        </div>
      ) : (
        <form
          className="mt-4 flex flex-1 flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onStart(title.trim());
              setTitle('');
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-sm text-muted-foreground">Start a class to give students a join code and open the broadcast room.</p>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Class title (optional)" aria-label="Class title" />
          <Button type="submit" className="mt-auto w-full" disabled={busy}>
            <Play />
            {busy ? 'Starting…' : 'Start class'}
          </Button>
        </form>
      )}

      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="End this class?"
        description={`This signs out all ${currentClass?.memberCount ?? 0} student${currentClass?.memberCount === 1 ? '' : 's'} and closes the broadcast room.`}
        confirmLabel="End class"
        destructive
        onConfirm={onEnd}
      />
    </section>
  );
}
