import { useEffect, useState } from 'react';
import { getRuntimeConfig } from '../../lib/runtime-config';

/** A media-library clip played on a student seat — a vocabulary item's audio
 * (Ser 10's "four key skills") or a listening test's clip. <audio src> can't
 * carry an Authorization header, so this fetches the same way every other
 * authenticated player asset does (PronunciationPlayer's fetchAsObjectUrl).
 * A clip that won't load says so: for a listening test, silently rendering
 * nothing would look like a test with no audio. */
export function ItemAudio({ assetId, token }: { assetId: string; token: string | null }) {
  const [state, setState] = useState<{ url?: string; failed?: boolean }>({});

  useEffect(() => {
    const { serverUrl } = getRuntimeConfig();
    let objectUrl: string | null = null;
    let cancelled = false;
    setState({});
    fetch(`${serverUrl}/api/media-assets/${assetId}/file`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load audio (${res.status})`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setState({ failed: true });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, token]);

  if (state.url) return <audio controls src={state.url} className="w-full" />;
  if (state.failed) return <p className="text-xs text-amber-500">Could not load the audio — tell your teacher.</p>;
  return <p className="text-xs text-muted-foreground">Loading audio…</p>;
}
