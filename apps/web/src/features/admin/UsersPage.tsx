import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRole } from '@lab/shared';
import { usersApi, type UserRow } from '../../lib/users-api';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const ROLE_TABS = ['ALL', UserRole.ADMIN, UserRole.TEACHER, UserRole.STUDENT] as const;

/**
 * LMS admin core — account management. `usersApi.create/setActive/
 * resetPassword` (and the server routes behind them) already existed
 * with no consumer; this is that consumer. Every write here is
 * ADMIN-only server-side (UsersController's method-level @Roles), same
 * as BatchesPage's create/edit.
 */
export function UsersPage() {
  const queryClient = useQueryClient();
  const [roleFilter, setRoleFilter] = useState<(typeof ROLE_TABS)[number]>('ALL');
  const { data: users, isLoading } = useQuery({
    queryKey: queryKeys.users(roleFilter === 'ALL' ? undefined : roleFilter),
    queryFn: () => usersApi.list(roleFilter === 'ALL' ? undefined : roleFilter),
  });

  const [open, setOpen] = useState(false);
  const [serviceNumber, setServiceNumber] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.STUDENT);
  const [rank, setRank] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);

  function invalidateAll(): void {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  const create = useMutation({
    mutationFn: () => usersApi.create({ serviceNumber, fullName, role, password, rank: rank || undefined }),
    onSuccess: () => {
      setOpen(false);
      setServiceNumber('');
      setFullName('');
      setRank('');
      setPassword('');
      setError(null);
      invalidateAll();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to create account'),
  });

  const toggleActive = useMutation({
    mutationFn: (u: UserRow) => usersApi.setActive(u.id, !u.active),
    onSuccess: invalidateAll,
  });

  const resetPassword = useMutation({
    mutationFn: () => usersApi.resetPassword(resetTarget!.id, newPassword),
    onSuccess: () => {
      setResetTarget(null);
      setNewPassword('');
      setResetError(null);
    },
    onError: (err) => setResetError(err instanceof Error ? err.message : 'Failed to reset password'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">Create admin/teacher/student accounts, deactivate, reset passwords.</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
          <DialogTrigger asChild>
            <Button>New Account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UserRole.ADMIN}>Admin</SelectItem>
                    <SelectItem value={UserRole.TEACHER}>Teacher</SelectItem>
                    <SelectItem value={UserRole.STUDENT}>Student</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Service Number</Label>
                <Input value={serviceNumber} onChange={(e) => setServiceNumber(e.target.value)} placeholder="e.g. STU-041" />
              </div>
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Rank (optional)</Label>
                <Input value={rank} onChange={(e) => setRank(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Initial Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                onClick={() => create.mutate()}
                disabled={create.isPending || !serviceNumber.trim() || !fullName.trim() || password.length < 8}
              >
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={roleFilter} onValueChange={(v) => setRoleFilter(v as (typeof ROLE_TABS)[number])}>
        <TabsList>
          {ROLE_TABS.map((r) => (
            <TabsTrigger key={r} value={r}>
              {r === 'ALL' ? 'All' : r.charAt(0) + r.slice(1).toLowerCase()}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service No.</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Rank</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.serviceNumber}</TableCell>
                    <TableCell>{u.fullName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{u.role}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.rank ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={u.active ? 'success' : 'secondary'}>{u.active ? 'Active' : 'Deactivated'}</Badge>
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setResetTarget(u)}>
                        Reset password
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate(u)} disabled={toggleActive.isPending}>
                        {u.active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {users?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      No accounts.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password — {resetTarget?.fullName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 8 characters" />
            </div>
            {resetError && <p className="text-sm text-destructive">{resetError}</p>}
          </div>
          <DialogFooter>
            <Button onClick={() => resetPassword.mutate()} disabled={resetPassword.isPending || newPassword.length < 8}>
              {resetPassword.isPending ? 'Saving…' : 'Reset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
