import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** A proper in-app replacement for window.confirm on consequential actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TEMPLATES = [
  'Please put on your headphones.',
  'Eyes on the instructor’s screen, please.',
  '5 minutes remaining.',
  'Please save your work now.',
  'Raise your hand if you need help.',
];

/** Compose a message to the selected consoles — replaces window.prompt. */
export function MessageDialog({
  open,
  onOpenChange,
  recipientCount,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientCount: number;
  onSend: (text: string, severity: 'info' | 'warning') => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warning'>('info');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setText('');
      setSeverity('info');
    }
  }, [open]);

  async function send(): Promise<void> {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onSend(text.trim(), severity);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send a message</DialogTitle>
          <DialogDescription>
            Shown on {recipientCount} selected console{recipientCount === 1 ? '' : 's'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setText(t)}
                className={cn(
                  'rounded-pill border px-2.5 py-1 text-xs transition-colors',
                  text === t ? 'border-brand bg-brand-soft text-brand' : 'border-input text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <Textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
            }}
            placeholder="Type a message…"
            rows={4}
            maxLength={280}
            aria-label="Message"
          />
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="inline-flex rounded-control border border-input p-0.5" role="radiogroup" aria-label="Message style">
              {(['info', 'warning'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={severity === s}
                  onClick={() => setSeverity(s)}
                  className={cn(
                    'rounded-[9px] px-3 py-1 font-medium capitalize transition-colors',
                    severity === s ? (s === 'warning' ? 'bg-status-pending/15 text-status-pending' : 'bg-brand-soft text-brand') : 'text-muted-foreground',
                  )}
                >
                  {s === 'info' ? 'Notice' : 'Warning'}
                </button>
              ))}
            </div>
            <span className="text-muted-foreground tabular-nums">{text.length} / 280 · Ctrl+Enter to send</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !text.trim()} onClick={() => void send()}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
