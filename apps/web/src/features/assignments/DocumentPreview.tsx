import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { gradebookApi } from '../../lib/gradebook-api';
import { AssetViewer } from '../media/AssetViewer';

/** Teacher-side preview of a media-library PDF. <iframe src> can't carry the
 * Authorization header, so the file is fetched as a blob and shown from an
 * object URL, revoked when the document changes or this unmounts — same
 * pattern as AudioPreview. The kind is always 'pdf': every document a
 * reading test can point at was verified to be one at upload/creation time
 * (AssessmentsService.assertStudentsCanRead), so there is no metadata fetch
 * to detect it from here. */
export function DocumentPreview({ assetId }: { assetId: string }) {
  const [state, setState] = useState<{ url?: string; failed?: boolean }>({});

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setState({});
    gradebookApi
      .fetchMediaAssetBlob(assetId)
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
  }, [assetId]);

  if (state.url) return <AssetViewer kind="pdf" url={state.url} title="Document" height="20rem" />;
  if (state.failed) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" /> Could not load the document.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading document…
    </p>
  );
}
