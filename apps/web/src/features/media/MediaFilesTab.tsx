import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MediaAssetScope, AssetKind } from '@lab/shared';
import { mediaAssetsApi, type MediaAsset, type MediaFolder } from '../../lib/media-assets-api';
import { studyModulesApi } from '../../lib/study-modules-api';
import { queryKeys } from '../../lib/query-keys';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// import { Checkbox } from '@/components/ui/checkbox'; // only used by the commented-out upload checkbox
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AssetPreviewDialog } from './AssetPreviewDialog';
import { AssetSharingDialog } from './AssetSharingDialog';
import { ALL_STUDENTS, ClassAudiencePicker, isAudienceComplete, toSharedBatchIds, useSharableClasses } from './ClassAudiencePicker';
import { assetKindOf } from './asset-kind';

/**
 * The "Files" tab of the Study Library page (formerly the Media Library page).
 * Ser 1 "media library... multi-teacher access facility for sharing and
 * collaborating content resources remotely across the campus." Upload feeds
 * masterTrackAssetId/modelAudioAssetId/ipaAssetId pickers on the Exercises
 * page and the module file picker; "Open" previews the file in a dialog via
 * an authenticated blob URL (a plain <a href> can't carry the bearer token).
 *
 * "Shared with" is the merge point with the student portal: a file switched on
 * here appears in Study Material without needing a module — for every student,
 * or only the students of the classes the teacher picked. A PRIVATE file can't
 * be shared (a student seat reads with its station token, never the owner), so
 * the two controls are kept consistent both here and on the server.
 *
 * Folders are teacher-side organisation only (students never see them): each
 * holds one kind of content, the upload card files into the selected folder,
 * and several files can be picked and uploaded in one go.
 */
export function MediaFilesTab() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const { data: assets, isLoading } = useQuery({ queryKey: queryKeys.mediaAssets, queryFn: mediaAssetsApi.list });
  const { data: modules } = useQuery({ queryKey: queryKeys.studyModules, queryFn: studyModulesApi.list });
  const { data: classes } = useSharableClasses();
  const { data: folders } = useQuery({ queryKey: queryKeys.mediaFolders, queryFn: mediaAssetsApi.listFolders });
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<string>(AssetKind.AUDIO);
  const [title, setTitle] = useState('');
  // Shared by default: a file only students can't open (PRIVATE) is the odd
  // case, and this page's main purpose is now feeding the student portal.
  // With the Scope dropdown and the "Show in students' Study Material" checkbox
  // commented out below, nothing changes these, so they no longer need setters:
  // every upload is INSTITUTION-scope and shared with students.
  const [scope] = useState<MediaAssetScope>(MediaAssetScope.INSTITUTION);
  const [studentVisible] = useState(true);
  const [audience, setAudience] = useState(ALL_STUDENTS);
  const [error, setError] = useState<string | null>(null);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);
  const [sharingAsset, setSharingAsset] = useState<MediaAsset | null>(null);
  // 'all' | 'unfiled' | a folder id — filters the table and picks the upload's folder.
  const [folderFilter, setFolderFilter] = useState('all');
  const [pickedCount, setPickedCount] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderKind, setNewFolderKind] = useState<string>(AssetKind.AUDIO);

  const selectedFolder: MediaFolder | null = folders?.find((f) => f.id === folderFilter) ?? null;
  const folderNameById = useMemo(() => new Map((folders ?? []).map((f) => [f.id, f.name])), [folders]);
  const visibleAssets = assets?.filter((a) =>
    folderFilter === 'all' ? true : folderFilter === 'unfiled' ? !a.folderId : a.folderId === folderFilter,
  );

  const classNameById = useMemo(() => new Map((classes ?? []).map((c) => [c.id, c.name])), [classes]);

  // asset id -> titles of the study modules it is attached to.
  const modulesByAsset = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const mod of modules ?? []) {
      for (const material of mod.materials) map.set(material.id, [...(map.get(material.id) ?? []), mod.title]);
    }
    return map;
  }, [modules]);

  /** Uploads the picked files one after another. A single file keeps the
   * chosen Kind and Title; with several, each file's kind is detected and its
   * own name is its title. Into a folder, every file must be the folder's kind.
   * Resolves with the files that could not be uploaded (bulk only — a single
   * file's failure rejects, as before). */
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const failed: string[] = [];
      const single = files.length === 1;
      for (const [i, file] of files.entries()) {
        const fileKind = selectedFolder || !single ? assetKindOf(file) : kind;
        const params = {
          kind: fileKind,
          title: single ? title || undefined : undefined,
          scope,
          studentVisible,
          sharedBatchIds: studentVisible ? toSharedBatchIds(audience) : undefined,
          folderId: selectedFolder?.id,
        };
        if (selectedFolder && fileKind !== selectedFolder.kind) {
          const problem = `"${file.name}" is not a ${selectedFolder.kind} file — "${selectedFolder.name}" only holds ${selectedFolder.kind} files`;
          if (single) throw new Error(problem);
          failed.push(problem);
        } else if (single) {
          await mediaAssetsApi.upload(file, params);
        } else {
          try {
            await mediaAssetsApi.upload(file, params);
          } catch (err) {
            failed.push(`"${file.name}": ${err instanceof Error ? err.message : 'upload failed'}`);
          }
        }
        setProgress({ done: i + 1, total: files.length });
      }
      return failed;
    },
    onSuccess: (failed) => {
      setTitle('');
      setPickedCount(0);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
      if (failed.length) setError(`Some files weren't uploaded — ${failed.join('; ')}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaAssets });
    },
    onError: (err) => {
      setProgress(null);
      setError(err instanceof Error ? err.message : 'Upload failed');
    },
  });

  const createFolder = useMutation({
    mutationFn: () => mediaAssetsApi.createFolder({ name: newFolderName.trim(), kind: newFolderKind }),
    onSuccess: (folder) => {
      setNewFolderOpen(false);
      setNewFolderName('');
      setFolderFilter(folder.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaFolders });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not create the folder'),
  });

  const removeFolder = useMutation({
    mutationFn: mediaAssetsApi.removeFolder,
    onSuccess: () => {
      setFolderFilter('all');
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaFolders });
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaAssets });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not delete the folder'),
  });

  const moveToFolder = useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) => mediaAssetsApi.update(id, { folderId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.mediaAssets }),
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not move the file'),
  });

  const remove = useMutation({
    mutationFn: mediaAssetsApi.remove,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaAssets });
      void queryClient.invalidateQueries({ queryKey: queryKeys.studyModules });
    },
  });

  // Only the Scope dropdown (commented out below) used this.
  // function changeScope(next: MediaAssetScope): void {
  //   setScope(next);
  //   if (next === MediaAssetScope.PRIVATE) setStudentVisible(false);
  // }

  // Only the "Show in students' Study Material" checkbox (commented out below) used this.
  // function changeStudentVisible(next: boolean): void {
  //   setStudentVisible(next);
  //   if (next && scope === MediaAssetScope.PRIVATE) setScope(MediaAssetScope.INSTITUTION);
  // }

  function canEdit(asset: MediaAsset): boolean {
    return user?.role === 'ADMIN' || asset.ownerId === user?.id;
  }

  /** What the "Shared with" button says, and the fuller list on hover. */
  function audienceSummary(asset: MediaAsset): { text: string; detail: string } {
    if (!asset.studentVisible) return { text: 'Not shared', detail: 'Students can’t see this file (unless it is in a module)' };
    const ids = asset.sharedBatchIds;
    if (ids.length === 0) return { text: 'All students', detail: 'Every student sees this file' };
    const names = ids.map((id) => classNameById.get(id) ?? 'another class');
    return { text: ids.length === 1 ? (names[0] ?? '1 class') : `${ids.length} classes`, detail: `Only students in: ${names.join(', ')}` };
  }

  function folderCount(id: string | null): number {
    return (assets ?? []).filter((a) => (a.folderId ?? null) === id).length;
  }

  const chipClass = (active: boolean): string =>
    `rounded-pill border px-3 py-1 text-sm transition-colors ${active ? 'border-brand bg-brand text-brand-ink' : 'border-border bg-card hover:bg-accent'}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Folders</CardTitle>
          <div className="flex gap-2">
            {selectedFolder && (user?.role === 'ADMIN' || selectedFolder.ownerId === user?.id) && (
              <Button
                size="sm"
                variant="ghost"
                disabled={removeFolder.isPending}
                onClick={() => {
                  if (window.confirm(`Delete the folder "${selectedFolder.name}"? Its files stay in the library, just not in a folder.`)) {
                    removeFolder.mutate(selectedFolder.id);
                  }
                }}
              >
                Delete folder
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setNewFolderOpen(true)}>
              New folder
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <button type="button" className={chipClass(folderFilter === 'all')} onClick={() => setFolderFilter('all')}>
            All files ({assets?.length ?? 0})
          </button>
          <button type="button" className={chipClass(folderFilter === 'unfiled')} onClick={() => setFolderFilter('unfiled')}>
            Not in a folder ({folderCount(null)})
          </button>
          {folders?.map((f) => (
            <button key={f.id} type="button" className={chipClass(folderFilter === f.id)} onClick={() => setFolderFilter(f.id)}>
              {f.name} <span className="opacity-70">· {f.kind} ({folderCount(f.id)})</span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Upload{selectedFolder ? ` to "${selectedFolder.name}"` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>Files (pick one or several)</Label>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={selectedFolder && selectedFolder.kind !== AssetKind.TEXT ? `${selectedFolder.kind}/*` : undefined}
              className="block text-sm"
              onChange={(e) => {
                const picked = e.target.files;
                setPickedCount(picked?.length ?? 0);
                if (picked?.length === 1 && picked[0]) setKind(assetKindOf(picked[0]));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Kind</Label>
            {selectedFolder || pickedCount > 1 ? (
              <p className="flex h-10 w-32 items-center text-sm text-muted-foreground">
                {selectedFolder ? selectedFolder.kind : 'Per file'}
              </p>
            ) : (
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(AssetKind).map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={pickedCount > 1 ? '' : title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pickedCount > 1}
              placeholder={pickedCount > 1 ? "Each file's own name" : 'Optional display name'}
              className="w-56"
            />
          </div>
          {/* <div className="space-y-1.5">
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(v) => changeScope(v as MediaAssetScope)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(MediaAssetScope).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div> */}
          {/* <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox checked={studentVisible} onCheckedChange={(c) => changeStudentVisible(c === true)} />
            Show in students' Study Material
          </label> */}
          {studentVisible && (
            <div className="space-y-1.5">
              <Label>Share with</Label>
              <ClassAudiencePicker value={audience} onChange={setAudience} />
            </div>
          )}
          <Button
            onClick={() => {
              const files = Array.from(fileRef.current?.files ?? []);
              if (files.length === 0) return;
              setError(null);
              setProgress(files.length > 1 ? { done: 0, total: files.length } : null);
              upload.mutate(files);
            }}
            disabled={upload.isPending || (studentVisible && !isAudienceComplete(audience))}
          >
            {upload.isPending
              ? progress
                ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                : 'Uploading…'
              : pickedCount > 1
                ? `Upload ${pickedCount} files`
                : 'Upload'}
          </Button>
          {error && <p className="w-full text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Folder</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-center">Shared with</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleAssets?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                      No files here yet.
                    </TableCell>
                  </TableRow>
                )}
                {visibleAssets?.map((asset) => {
                  const inModules = modulesByAsset.get(asset.id);
                  const isPrivate = asset.scope === MediaAssetScope.PRIVATE;
                  const editable = canEdit(asset);
                  const summary = audienceSummary(asset);
                  const hint = isPrivate
                    ? 'A private file can’t be shown to students — share it with the department or institution first'
                    : !editable
                      ? `${summary.detail} — only the owner or an admin can change this`
                      : `${summary.detail} — click to change`;
                  return (
                    <TableRow key={asset.id}>
                      <TableCell>
                        {asset.title ?? asset.filename}
                        {inModules && <p className="text-xs text-muted-foreground">In module: {inModules.join(', ')}</p>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{asset.kind}</Badge>
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <Select
                            value={asset.folderId ?? 'none'}
                            onValueChange={(v) => moveToFolder.mutate({ id: asset.id, folderId: v === 'none' ? null : v })}
                          >
                            <SelectTrigger className="h-8 w-40 text-xs" aria-label={`Folder for ${asset.title ?? asset.filename}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No folder</SelectItem>
                              {folders
                                ?.filter((f) => f.kind === asset.kind)
                                .map((f) => (
                                  <SelectItem key={f.id} value={f.id}>
                                    {f.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs text-muted-foreground">{asset.folderId ? folderNameById.get(asset.folderId) : '—'}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{asset.scope}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{(asset.sizeBytes / 1024).toFixed(1)} KB</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(asset.createdAt).toLocaleString()}</TableCell>
                      <TableCell className="text-center">
                        <span title={hint} className="inline-flex">
                          <Button
                            size="sm"
                            variant={asset.studentVisible ? 'secondary' : 'ghost'}
                            className="max-w-40"
                            aria-label={`Share ${asset.title ?? asset.filename} with students: currently ${summary.text}`}
                            disabled={isPrivate || !editable}
                            onClick={() => setSharingAsset(asset)}
                          >
                            <span className="truncate">{isPrivate ? 'Private' : summary.text}</span>
                          </Button>
                        </span>
                      </TableCell>
                      <TableCell className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setPreviewAsset(asset)}>
                          Open
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove.mutate(asset.id)}>
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Folder name</Label>
              <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="e.g. A1 Listening audio" maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label>Type of content it holds</Label>
              <Select value={newFolderKind} onValueChange={setNewFolderKind}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(AssetKind).map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => createFolder.mutate()} disabled={createFolder.isPending || !newFolderName.trim()}>
              {createFolder.isPending ? 'Creating…' : 'Create folder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AssetPreviewDialog asset={previewAsset} onClose={() => setPreviewAsset(null)} />
      <AssetSharingDialog asset={sharingAsset} onClose={() => setSharingAsset(null)} />
    </div>
  );
}
