import { useEffect, useState } from 'react';
import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import { gradebookApi } from '../../lib/gradebook-api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AssetViewer, previewKind } from './AssetViewer';

/** Just what the reader needs — satisfied by a library MediaAsset and by a study module's file alike. */
export interface PreviewableAsset {
  id: string;
  title?: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** Teacher-side reader for a media-library file: "Open" shows it here instead of downloading it. */
export function AssetPreviewDialog({ asset, onClose }: { asset: PreviewableAsset | null; onClose: () => void }) {
  return (
    <Dialog open={asset !== null} onOpenChange={(open) => !open && onClose()}>
      {asset && (
        <DialogContent className="max-h-[95vh] max-w-4xl overflow-y-auto">
          <PreviewBody asset={asset} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function PreviewBody({ asset }: { asset: PreviewableAsset }) {
  const kind = previewKind(asset);
  const title = asset.title ?? asset.filename;
  const [state, setState] = useState<{ url?: string; failed?: boolean }>({});
  const [downloadFailed, setDownloadFailed] = useState(false);

  // <audio>/<img>/<iframe> `src` can't carry the Authorization header, so the
  // file is fetched as a blob and shown from an object URL, revoked on close.
  useEffect(() => {
    if (!kind) return;
    let cancelled = false;
    let created: string | null = null;
    setState({});
    gradebookApi
      .fetchMediaAssetBlob(asset.id)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setState({ url });
      })
      .catch(() => {
        if (!cancelled) setState({ failed: true });
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [asset.id, kind]);

  async function download(): Promise<void> {
    setDownloadFailed(false);
    try {
      const url = state.url ?? (await gradebookApi.fetchMediaAssetBlob(asset.id));
      const a = document.createElement('a');
      a.href = url;
      a.download = asset.filename;
      a.click();
      if (url !== state.url) setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setDownloadFailed(true);
    }
  }

  return (
    <>
      <DialogHeader className="pr-6">
        <DialogTitle className="truncate">{title}</DialogTitle>
        <DialogDescription className="truncate">
          {asset.filename} · {(asset.sizeBytes / 1024).toFixed(1)} KB
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-24">
        {!kind ? (
          <p className="text-sm text-muted-foreground">There's no in-browser preview for this file type — download it to open it.</p>
        ) : state.url ? (
          <AssetViewer kind={kind} url={state.url} title={title} height="60vh" />
        ) : state.failed ? (
          <p className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" /> Could not load this file.
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        )}
      </div>

      <DialogFooter className="items-center">
        {downloadFailed && <p className="text-xs text-amber-600 dark:text-amber-400">Could not download this file.</p>}
        <Button variant="outline" size="sm" onClick={() => void download()}>
          <Download className="mr-1.5 h-4 w-4" /> Download
        </Button>
      </DialogFooter>
    </>
  );
}
