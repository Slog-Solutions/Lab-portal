import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MediaAssetScope, AssetKind, ContentPackageFormat } from '@lab/shared';
import { mediaAssetsApi } from '../../lib/media-assets-api';
import { contentPackagesApi } from '../../lib/content-packages-api';
import { getRuntimeConfig } from '../../lib/runtime-config';
import { useAuthStore } from '../../stores/auth-store';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Ser 1 "media library... multi-teacher access facility for sharing and
 * collaborating content resources remotely across the campus." Upload
 * feeds masterTrackAssetId/modelAudioAssetId/ipaAssetId pickers on the
 * Exercises page; playback opens the file via an authenticated blob URL
 * (a plain <a href> can't carry the bearer token).
 */
export function MediaLibraryPage() {
  const queryClient = useQueryClient();
  const { data: assets, isLoading } = useQuery({ queryKey: queryKeys.mediaAssets, queryFn: mediaAssetsApi.list });
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<string>(AssetKind.AUDIO);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<MediaAssetScope>(MediaAssetScope.PRIVATE);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => mediaAssetsApi.upload(file, { kind, title: title || undefined, scope }),
    onSuccess: () => {
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaAssets });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Upload failed'),
  });

  const remove = useMutation({
    mutationFn: mediaAssetsApi.remove,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.mediaAssets }),
  });

  async function playOrDownload(id: string, filename: string): Promise<void> {
    const { serverUrl } = getRuntimeConfig();
    const token = useAuthStore.getState().accessToken;
    const res = await fetch(`${serverUrl}/api/media-assets/${id}/file`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Media Library</h1>
        <p className="text-sm text-muted-foreground">Master tracks, model audio, source texts and images shared across the lab.</p>
      </div>

      <Tabs defaultValue="assets">
        <TabsList>
          <TabsTrigger value="assets">Media Assets</TabsTrigger>
          <TabsTrigger value="content">Content Packages (SCORM/xAPI/HTML)</TabsTrigger>
        </TabsList>

        <TabsContent value="assets" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upload</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>File</Label>
                <input ref={fileRef} type="file" className="block text-sm" />
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
              <div className="space-y-1.5">
                <Label>Scope</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as MediaAssetScope)}>
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
              </div>
              <Button
                onClick={() => fileRef.current?.files?.[0] && upload.mutate(fileRef.current.files[0])}
                disabled={upload.isPending}
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
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets?.map((asset) => (
                      <TableRow key={asset.id}>
                        <TableCell>{asset.title ?? asset.filename}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{asset.kind}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{asset.scope}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{(asset.sizeBytes / 1024).toFixed(1)} KB</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(asset.createdAt).toLocaleString()}</TableCell>
                        <TableCell className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => void playOrDownload(asset.id, asset.filename)}>
                            Open
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove.mutate(asset.id)}>
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="content">
          <ContentPackagesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ContentPackagesTab() {
  const queryClient = useQueryClient();
  const { data: packages, isLoading } = useQuery({ queryKey: queryKeys.contentPackages, queryFn: contentPackagesApi.list });
  const fileRef = useRef<HTMLInputElement>(null);
  const [pkgTitle, setPkgTitle] = useState('');
  const [format, setFormat] = useState<string>(ContentPackageFormat.SCORM12);
  const [scope, setScope] = useState<MediaAssetScope>(MediaAssetScope.INSTITUTION);
  const [error, setError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: (file: File) => contentPackagesApi.import(file, { title: pkgTitle, format, scope }),
    onSuccess: () => {
      setPkgTitle('');
      if (fileRef.current) fileRef.current.value = '';
      void queryClient.invalidateQueries({ queryKey: queryKeys.contentPackages });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Import failed'),
  });
  const remove = useMutation({
    mutationFn: contentPackagesApi.remove,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.contentPackages }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import a package</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>File (.zip for SCORM/xAPI, or a single .html)</Label>
            <input ref={fileRef} type="file" accept=".zip,.html" className="block text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={pkgTitle} onChange={(e) => setPkgTitle(e.target.value)} className="w-56" />
          </div>
          <div className="space-y-1.5">
            <Label>Format</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(ContentPackageFormat).map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as MediaAssetScope)}>
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
          </div>
          <Button
            onClick={() => fileRef.current?.files?.[0] && pkgTitle && importMutation.mutate(fileRef.current.files[0])}
            disabled={importMutation.isPending || !pkgTitle}
          >
            {importMutation.isPending ? 'Importing…' : 'Import'}
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
                  <TableHead>Format</TableHead>
                  <TableHead>Entry point</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Imported</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages?.map((pkg) => (
                  <TableRow key={pkg.id}>
                    <TableCell>{pkg.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{pkg.format}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{pkg.entryPoint}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{(pkg.sizeBytes / 1024).toFixed(1)} KB</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(pkg.importedAt).toLocaleString()}</TableCell>
                    <TableCell className="flex justify-end">
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(pkg.id)}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
