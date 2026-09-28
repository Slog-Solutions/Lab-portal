import { useEffect, useRef, useState } from 'react';
import { stationApi } from '../../lib/station-api';
import { Button } from '@/components/ui/button';
import { AssetViewer, previewKind } from '../media/AssetViewer';

type Material = Awaited<ReturnType<typeof stationApi.studyLibrary>>[number]['materials'][number];

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * One teacher-uploaded file in a study module. The file is only fetched once
 * the student opens or downloads it (a module can hold several large clips),
 * and — like ItemAudio — via fetch + blob URL, because <audio>/<img>/<iframe>
 * `src` can't carry the station's Authorization header.
 */
export function StudyMaterialItem({ material, token }: { material: Material; token: string | null }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<string | null>(null);
  const kind = previewKind(material);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function load(): Promise<string> {
    if (urlRef.current) return urlRef.current;
    const objectUrl = await stationApi.fetchBlobUrl(token, `/media-assets/${material.id}/file`);
    urlRef.current = objectUrl;
    setUrl(objectUrl);
    return objectUrl;
  }

  async function toggleOpen(): Promise<void> {
    if (open) {
      setOpen(false);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await load();
      setOpen(true);
    } catch {
      setError('Could not load this file — tell your teacher.');
    } finally {
      setBusy(false);
    }
  }

  async function download(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const a = document.createElement('a');
      a.href = await load();
      a.download = material.filename;
      a.click();
    } catch {
      setError('Could not load this file — tell your teacher.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm">{material.title}</p>
          <p className="text-xs text-muted-foreground">
            {material.kind} · {formatSize(material.sizeBytes)}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {kind && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void toggleOpen()}>
              {open ? 'Close' : 'Open'}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void download()}>
            Download
          </Button>
        </div>
      </div>
      {open && url && kind && (
        <div className="mt-2">
          <AssetViewer kind={kind} url={url} title={material.title} />
        </div>
      )}
      {error && <p className="mt-1 text-xs text-amber-500">{error}</p>}
    </div>
  );
}
