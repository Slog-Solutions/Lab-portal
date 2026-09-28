import { useState } from 'react';
import { Button } from '@/components/ui/button';

/** Submit for a one-shot test. The server locks a test once it is handed in
 * (AttemptsService.assertTestStartable), so a stray click must not end it —
 * the first click asks, the second submits. */
export function SubmitBar({
  disabled,
  submitting,
  onSubmit,
  note,
}: {
  disabled?: boolean;
  submitting: boolean;
  onSubmit: () => void;
  note?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming && !submitting) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
        <p className="text-sm">This is your only attempt. Submit now?</p>
        <Button
          onClick={() => {
            setConfirming(false);
            onSubmit();
          }}
        >
          Yes, submit
        </Button>
        <Button variant="outline" onClick={() => setConfirming(false)}>
          Keep working
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => setConfirming(true)} disabled={disabled || submitting}>
        {submitting ? 'Submitting…' : 'Submit'}
      </Button>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}
