import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { gradebookApi } from '../../lib/gradebook-api';

/** Teacher-side playback of a media-library clip. <audio src> can't carry
 * the Authorization header, so the file is fetched as a blob and played
 * from an object URL, revoked when the clip changes or this unmounts. */
export function AudioPreview({ assetId }: { assetId: string }) {
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

  if (state.url) return <audio controls src={state.url} className="h-9 w-full" />;
  if (state.failed) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" /> Could not load the audio.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading audio…
    </p>
  );
}
