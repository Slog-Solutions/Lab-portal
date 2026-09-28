import { useEffect, useState } from 'react';
import type { DictionaryMeta } from '@lab/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi } from '../../lib/station-api';

/**
 * Attribution obligations (spec §9) — full licence text, source versions
 * and build date, read live from the dictionary.db `meta` table via
 * GET /dictionary/meta (DictionaryStoreService.getMetaInfo), not
 * hard-coded here — the same file that names OEWN's exact version is the
 * one this dialog quotes, so the two can never drift apart.
 */
export function DictionaryAbout({
  control,
  open,
  onOpenChange,
}: {
  control: StationControlClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [meta, setMeta] = useState<DictionaryMeta | null>(null);

  useEffect(() => {
    if (!open) return;
    stationApi
      .dictionaryMeta(control.getToken())
      .then(setMeta)
      .catch(() => setMeta({ available: false, reason: 'Could not reach the server' }));
  }, [open, control]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Dictionary — About &amp; licences</DialogTitle>
        </DialogHeader>
        {!meta ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !meta.available ? (
          <p className="text-sm text-muted-foreground">Dictionary unavailable — check with your teacher.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <dt className="font-medium text-foreground">Sources</dt>
              <dd>{meta.sources?.join(', ') ?? '—'}</dd>
              <dt className="font-medium text-foreground">Licence mode</dt>
              <dd>{meta.licenceMode ?? '—'}</dd>
              <dt className="font-medium text-foreground">Open English WordNet version</dt>
              <dd>{meta.oewnVersion ?? '—'}</dd>
              <dt className="font-medium text-foreground">Built</dt>
              <dd>{meta.builtAt ? new Date(meta.builtAt).toLocaleString() : '—'}</dd>
            </dl>
            <p className="whitespace-pre-line rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed">
              {meta.licenceText ?? meta.attribution ?? 'Open English WordNet (CC BY 4.0), derived from Princeton WordNet.'}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
