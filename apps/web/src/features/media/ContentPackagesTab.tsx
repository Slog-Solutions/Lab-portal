import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MediaAssetScope, ContentPackageFormat } from '@lab/shared';
import { contentPackagesApi } from '../../lib/content-packages-api';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

/** SCORM / xAPI / HTML content packages — the third tab of the Study Library page. */
export function ContentPackagesTab() {
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
