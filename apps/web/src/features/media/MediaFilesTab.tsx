import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MediaAssetScope, AssetKind } from '@lab/shared';
import { mediaAssetsApi, type MediaAsset } from '../../lib/media-assets-api';
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
 */
export function MediaFilesTab() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const { data: assets, isLoading } = useQuery({ queryKey: queryKeys.mediaAssets, queryFn: mediaAssetsApi.list });
  const { data: modules } = useQuery({ queryKey: queryKeys.studyModules, queryFn: studyModulesApi.list });
  const { data: classes } = useSharableClasses();
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

  const classNameById = useMemo(() => new Map((classes ?? []).map((c) => [c.id, c.name])), [classes]);

  // asset id -> titles of the study modules it is attached to.
  const modulesByAsset = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const mod of modules ?? []) {
      for (const material of mod.materials) map.set(material.id, [...(map.get(material.id) ?? []), mod.title]);
    }
    return map;
  }, [modules]);

  const upload = useMutation({
    mutationFn: (file: File) =>
      mediaAssetsApi.upload(file, {
        kind,
        title: title || undefined,
        scope,
        studentVisible,
        sharedBatchIds: studentVisible ? toSharedBatchIds(audience) : undefined,
      }),
    onSuccess: () => {
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaAssets });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Upload failed'),
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>File</Label>
            <input
              ref={fileRef}
              type="file"
              className="block text-sm"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) setKind(assetKindOf(picked));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Kind</Label>
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
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional display name" className="w-56" />
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
              const file = fileRef.current?.files?.[0];
              if (!file) return;
              setError(null);
              upload.mutate(file);
            }}
            disabled={upload.isPending || (studentVisible && !isAudienceComplete(audience))}
          >
            {upload.isPending ? 'Uploading…' : 'Upload'}
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
                  <TableHead>Scope</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-center">Shared with</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets?.map((asset) => {
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

      <AssetPreviewDialog asset={previewAsset} onClose={() => setPreviewAsset(null)} />
      <AssetSharingDialog asset={sharingAsset} onClose={() => setSharingAsset(null)} />
    </div>
  );
}
