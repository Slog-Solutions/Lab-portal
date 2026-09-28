import { useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { stationApi } from '../../lib/station-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * Attaches a signed-in seat to the teacher's live class. Sign-in itself
 * needs no class, so this is where a student enters the short code the
 * teacher reads out when they start one (POST /classroom/join). Rendered
 * only while the seat has no live class — once joined, the server pushes a
 * fresh station snapshot and StudentConsole's header shows the class, which
 * is also what unmounts this card, so there is no local "joined" state to
 * keep in sync.
 *
 * This is separate from My classes' batch join: that one is a lasting
 * membership (code + key); this is "which teacher's session is this PC in
 * right now", and it is what lets the teacher spotlight and broadcast to
 * the seat.
 */
export function JoinLiveClassCard({ stationToken }: { stationToken: string | null }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(): Promise<void> {
    if (!stationToken || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await stationApi.joinLiveClass(stationToken, code.trim());
      setCode('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError('Too many tries. Wait a minute and try again.');
      else setError(err instanceof Error ? err.message : 'Could not join the live class');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Join a live class</CardTitle>
        <CardDescription>Your teacher will give you a short code when the class starts.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="live-class-code">Live class code</Label>
            <Input
              id="live-class-code"
              value={code}
              maxLength={12}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void join();
              }}
              placeholder="e.g. AB3F7K"
              className="w-40 uppercase tracking-widest"
            />
          </div>
          <Button onClick={() => void join()} disabled={busy || !stationToken || !code.trim()}>
            {busy ? 'Joining…' : 'Join'}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
