import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MediaAssetScope } from '@lab/shared';
import { mediaAssetsApi, type MediaAsset } from '../../lib/media-assets-api';
import { queryKeys } from '../../lib/query-keys';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Pick files that are already in the library (the Files tab) to attach to a
 * study module, instead of uploading the same file a second time. PRIVATE files
 * are not offered — a module's files must be readable by a student seat (see
 * StudyModulesService.requireMaterialsShareable) — and neither are the ones
 * the module already has (`excludeIds`).
 */
export function LibraryFilePicker({
  open,
  onOpenChange,
  excludeIds,
  busy = false,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  excludeIds: ReadonlySet<string>;
  busy?: boolean;
  onPick: (assets: MediaAsset[]) => void;
}) {
  const { data: assets, isLoading } = useQuery({ queryKey: queryKeys.mediaAssets, queryFn: mediaAssetsApi.list, enabled: open });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const available = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (assets ?? []).filter(
      (a) =>
        a.scope !== MediaAssetScope.PRIVATE &&
        !excludeIds.has(a.id) &&
        (needle === '' || (a.title ?? a.filename).toLowerCase().includes(needle) || a.filename.toLowerCase().includes(needle)),
    );
  }, [assets, excludeIds, search]);

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleOpenChange(next: boolean): void {
    if (!next) {
      setSearch('');
      setSelected(new Set());
    }
    onOpenChange(next);
  }

  function confirm(): void {
    onPick((assets ?? []).filter((a) => selected.has(a.id)));
    handleOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add from library</DialogTitle>
          <DialogDescription>Files already uploaded in the Files tab. Private files aren't listed — students couldn't open them.</DialogDescription>
        </DialogHeader>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files…" />
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {isLoading && <p className="p-1.5 text-xs text-muted-foreground">Loading…</p>}
          {available.map((asset) => (
            <label key={asset.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/50">
              <Checkbox checked={selected.has(asset.id)} onCheckedChange={() => toggle(asset.id)} />
              <span className="flex-1 truncate">{asset.title ?? asset.filename}</span>
              <Badge variant="outline">{asset.kind}</Badge>
              <span className="text-xs text-muted-foreground">{formatSize(asset.sizeBytes)}</span>
            </label>
          ))}
          {!isLoading && available.length === 0 && (
            <p className="p-1.5 text-xs text-muted-foreground">
              {search ? 'No files match.' : 'No shared files to add — upload one in the Files tab first.'}
            </p>
          )}
        </div>
        <Button onClick={confirm} disabled={selected.size === 0 || busy}>
          {selected.size === 0 ? 'Add files' : `Add ${selected.size} ${selected.size === 1 ? 'file' : 'files'}`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
