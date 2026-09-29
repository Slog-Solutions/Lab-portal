import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

/** How a media-library file can be read in place; anything else is download-only. */
export type PreviewKind = 'audio' | 'video' | 'image' | 'pdf' | 'text';

/** Text is read into a <pre>, so a huge file would stall the page — past this, offer the download instead. */
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'srt', 'vtt', 'lrc']);

/**
 * An HTML document is deliberately never previewable: a blob: URL takes this
 * app's origin, so an uploaded .html shown in an <iframe> would run script
 * with access to the signed-in session. Text is rendered as inert text, and
 * images go through <img> (which never executes SVG script).
 */
export function previewKind(file: { mimeType: string; filename: string; sizeBytes: number }): PreviewKind | null {
  const mime = file.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';

  // Browsers often label a .md (or other unregistered extension) as octet-stream, so trust the extension then.
  const knownAsText = mime.startsWith('text/') ? mime !== 'text/html' : mime === 'application/json';
  const unlabelled = mime === '' || mime === 'application/octet-stream';
  const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
  if ((knownAsText || (unlabelled && TEXT_EXTENSIONS.has(ext))) && file.sizeBytes <= MAX_TEXT_PREVIEW_BYTES) return 'text';
  return null;
}

function TextView({ url, height }: { url: string; height: string }) {
  const [state, setState] = useState<{ text?: string; failed?: boolean }>({});

  useEffect(() => {
    let cancelled = false;
    setState({});
    fetch(url)
      .then((res) => res.text())
      .then((text) => {
        if (!cancelled) setState({ text });
      })
      .catch(() => {
        if (!cancelled) setState({ failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state.failed) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-status-pending">
        <AlertTriangle className="h-3.5 w-3.5" /> Could not read this file.
      </p>
    );
  }
  if (state.text === undefined) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
      </p>
    );
  }
  return (
    <pre
      className="overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-sans text-sm leading-relaxed"
      style={{ maxHeight: height }}
    >
      {state.text}
    </pre>
  );
}

/**
 * Renders an already-fetched object URL in the way its kind needs. The caller
 * owns fetching (with its own auth — user JWT vs station token) and revoking
 * the URL, because <audio>/<img>/<iframe> `src` can't carry an Authorization
 * header. `height` is any CSS length: the fixed height of a PDF frame, and the
 * cap for everything else.
 */
export function AssetViewer({ kind, url, title, height = '24rem' }: { kind: PreviewKind; url: string; title: string; height?: string }) {
  switch (kind) {
    case 'audio':
      return <audio controls src={url} className="w-full" />;
    case 'video':
      return <video controls src={url} className="w-full rounded-md bg-black" style={{ maxHeight: height }} />;
    case 'image':
      return <img src={url} alt={title} className="mx-auto rounded-md object-contain" style={{ maxHeight: height }} />;
    case 'pdf':
      return <iframe src={url} title={title} className="w-full rounded-md border border-border bg-white" style={{ height }} />;
    case 'text':
      return <TextView url={url} height={height} />;
  }
}
