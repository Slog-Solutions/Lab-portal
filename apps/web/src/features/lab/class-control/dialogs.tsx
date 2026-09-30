import { useEffect, useState, type ReactNode } from 'react';
import { Globe, Loader2, Rocket, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
  'Eyes on the instructorâ€™s screen, please.',
  '5 minutes remaining.',
  'Please save your work now.',
  'Raise your hand if you need help.',
];

/** Compose a message to the selected consoles â€” replaces window.prompt. */
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
            placeholder="Type a messageâ€¦"
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
            <span className="text-muted-foreground tabular-nums">{text.length} / 280 Â· Ctrl+Enter to send</span>
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

/** Open a web page in the default browser of every selected console. Only
 * http(s) is accepted (the station enforces this too). Offline lab: point at
 * a LAN address such as the lab server. */
export function OpenUrlDialog({
  open,
  onOpenChange,
  recipientCount,
  onOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientCount: number;
  onOpen: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setUrl('');
  }, [open]);

  const normalized = /^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url.trim() : `http://${url.trim()}`;
  const valid = (() => {
    try {
      const u = new URL(normalized);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  })();

  async function submit(): Promise<void> {
    if (!url.trim() || !valid) return;
    setBusy(true);
    try {
      await onOpen(normalized);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Open website</DialogTitle>
          <DialogDescription>
            Opens this page in the browser on {recipientCount} selected console{recipientCount === 1 ? '' : 's'}. The lab is offline, so use a local address.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder="http://labserver.lab.local/…"
          aria-label="Website address"
        />
        {url.trim() && !valid && <p className="text-xs text-destructive">Enter a valid http:// or https:// address.</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !valid} onClick={() => void submit()}>
            {busy ? <Loader2 className="animate-spin" /> : <Globe />}
            Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PROGRAMS = [
  { id: 'notepad', label: 'Notepad' },
  { id: 'calculator', label: 'Calculator' },
];

/** Launch an allowlisted program on every selected console. */
export function LaunchProgramDialog({
  open,
  onOpenChange,
  recipientCount,
  onLaunch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientCount: number;
  onLaunch: (programId: string, label: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function launch(id: string, label: string): Promise<void> {
    setBusy(true);
    try {
      await onLaunch(id, label);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Launch program</DialogTitle>
          <DialogDescription>
            Starts the program on {recipientCount} selected console{recipientCount === 1 ? '' : 's'}. Only allowlisted programs can be launched.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {PROGRAMS.map((p) => (
            <Button key={p.id} variant="outline" disabled={busy} onClick={() => void launch(p.id, p.label)}>
              <Rocket />
              {p.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
