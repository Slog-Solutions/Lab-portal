import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AssetKind, MediaAssetScope } from '@lab/shared';
import { Loader2, X } from 'lucide-react';
import { mediaAssetsApi, type MediaAsset } from '../../lib/media-assets-api';
import { queryKeys } from '../../lib/query-keys';
import { AudioPreview } from './AudioPreview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Where a listening test's audio comes from: a new upload, or a clip already
 * in the Media Library. Students play it with their seat's token, and a
 * PRIVATE asset is readable only by its owner — so an upload is filed as
 * INSTITUTION, and the library list shows only clips that are already shared
 * (the server refuses a private one too; see AssessmentsService).
 */
export function AudioPicker({ value, onChange }: { value: MediaAsset | null; onChange: (asset: MediaAsset | null) => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'upload' | 'library'>('upload');

  const { data: assets, isLoading } = useQuery({ queryKey: queryKeys.mediaAssets, queryFn: mediaAssetsApi.list, enabled: mode === 'library' });
  const shared = (assets ?? []).filter((a) => a.kind === AssetKind.AUDIO && a.scope !== MediaAssetScope.PRIVATE);

  const upload = useMutation({
    mutationFn: (file: File) =>
      mediaAssetsApi.upload(file, {
        kind: AssetKind.AUDIO,
        title: file.name.replace(/\.[^.]+$/, ''),
        scope: MediaAssetScope.INSTITUTION,
      }),
    onSuccess: (asset) => {
      onChange(asset);
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaAssets });
    },
  });

  if (value) {
    return (
      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{value.title || value.filename}</p>
          <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => onChange(null)}>
            <X className="h-3.5 w-3.5" />
            Change
          </Button>
        </div>
        <AudioPreview assetId={value.id} />
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant={mode === 'upload' ? 'default' : 'outline'} onClick={() => setMode('upload')}>
          Upload a file
        </Button>
        <Button type="button" size="sm" variant={mode === 'library' ? 'default' : 'outline'} onClick={() => setMode('library')}>
          Media Library
        </Button>
      </div>

      {mode === 'upload' ? (
        <div className="space-y-1.5">
          <Input
            type="file"
            accept="audio/*"
            disabled={upload.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // so picking the same file again still fires
              if (file) upload.mutate(file);
            }}
          />
          {upload.isPending && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
            </p>
          )}
          {upload.isError && <p className="text-xs text-destructive">{upload.error instanceof Error ? upload.error.message : 'Upload failed'}</p>}
          <p className="text-xs text-muted-foreground">The clip is shared with the lab so students can play it.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {isLoading ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </p>
          ) : shared.length === 0 ? (
            <p className="text-xs text-muted-foreground">No shared audio in the library yet — upload a file instead.</p>
          ) : (
            <select
              aria-label="Audio clip from the Media Library"
              defaultValue=""
              onChange={(e) => onChange(shared.find((a) => a.id === e.target.value) ?? null)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="" disabled>
                Choose a clip…
              </option>
              {shared.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title || a.filename}
                </option>
              ))}
            </select>
          )}
          <p className="text-xs text-muted-foreground">Only clips shared with the lab are listed — students can&apos;t play private ones.</p>
        </div>
      )}
    </div>
  );
}
