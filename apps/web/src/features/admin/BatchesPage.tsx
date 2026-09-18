import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { batchesApi, type BatchRow } from '../../lib/batches-api';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

/**
 * LMS admin core — admin creates batches (typing both a display code and
 * a join key by hand) and assigns teachers/students from BatchDetailPage.
 * joinKey is shown here only because this page is ADMIN-only
 * (BatchesService.ADMIN_BATCH_SELECT); teachers/students never receive it.
 */
export function BatchesPage() {
  const queryClient = useQueryClient();
  const { data: batches, isLoading } = useQuery({ queryKey: queryKeys.adminBatches, queryFn: batchesApi.list });

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [joinKey, setJoinKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const create = useMutation({
    mutationFn: () => batchesApi.create({ code, name, joinKey }),
    onSuccess: () => {
      setOpen(false);
      setCode('');
      setName('');
      setJoinKey('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminBatches });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to create batch'),
  });

  function toggleReveal(id: string): void {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Batches</h1>
          <p className="text-sm text-muted-foreground">Create batches, assign teachers and manage the student roster.</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
          <DialogTrigger asChild>
            <Button>New Batch</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Batch</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Batch ID</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. ACTC-B02" />
              </div>
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ACTC Batch 02" />
              </div>
              <div className="space-y-1.5">
                <Label>Batch Key</Label>
                <Input value={joinKey} onChange={(e) => setJoinKey(e.target.value)} placeholder="Read this out to students to let them join" />
                <p className="text-xs text-muted-foreground">At least 6 characters.</p>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                onClick={() => create.mutate()}
                disabled={create.isPending || code.trim().length < 3 || !name.trim() || joinKey.trim().length < 6}
              >
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Batch Key</TableHead>
                  <TableHead>Students</TableHead>
                  <TableHead>Teachers</TableHead>
                  <TableHead>Joining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches?.map((b: BatchRow) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link to={`/admin/batches/${b.id}`} className="font-medium text-primary hover:underline">
                        {b.code}
                      </Link>
                    </TableCell>
                    <TableCell>{b.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs">{revealed.has(b.id) ? b.joinKey : '••••••••'}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleReveal(b.id)}>
                          {revealed.has(b.id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>{b._count.enrollments}</TableCell>
                    <TableCell>{b._count.teachers ?? 0}</TableCell>
                    <TableCell>
                      <Badge variant={b.joinOpen ? 'success' : 'secondary'}>{b.joinOpen ? 'Open' : 'Closed'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {batches?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      No batches yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
