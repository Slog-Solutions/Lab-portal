import { useState } from 'react';
import { stationApi } from '../../lib/station-api';
import { useStudentSession } from '../../stores/student-session-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * Full-screen sign-in gate for an idle seat (replaces the old passwordless
 * "type your service number" claim card — see StationsService.claim's doc
 * comment). Deliberately NOT a route guard: StudentConsole always mounts
 * (and always connects StationControlClient) regardless of sign-in state,
 * because gating /student itself was a real regression once (see
 * router.tsx's doc comment) — the station runtime, broadcast, and remote
 * control must keep working on a signed-out seat. This component only
 * covers the content area; StudentConsole still renders its own header,
 * toast, and the hidden <video>/<audio> elements above/around it.
 *
 * Four required fields, matching the real classroom flow (decision: "there
 * is no sign-in without an active class code"): service number, password,
 * system number (the number written on this PC's own screen — becomes its
 * seat number with no admin step, see StationsService.claim) and classroom
 * code (given by the teacher when they start a class). `stationToken` is
 * the seat's own credential, minted at station:hello — a sign-in can't be
 * sent before it exists, so the button stays disabled until StudentConsole
 * passes one down (see its onToken wiring).
 */
export function StudentSignInScreen({
  stationToken,
  defaultSystemNumber,
}: {
  stationToken: string | null;
  defaultSystemNumber: number | null;
}) {
  const setSession = useStudentSession((s) => s.setSession);
  const [serviceNumber, setServiceNumber] = useState('');
  const [password, setPassword] = useState('');
  const [systemNumber, setSystemNumber] = useState(defaultSystemNumber !== null ? String(defaultSystemNumber) : '');
  const [classCode, setClassCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const systemNumberValue = Number(systemNumber);
  const canSubmit =
    !!stationToken &&
    !!serviceNumber.trim() &&
    !!password &&
    systemNumber.trim() !== '' &&
    Number.isInteger(systemNumberValue) &&
    systemNumberValue >= 1 &&
    systemNumberValue <= 40 &&
    !!classCode.trim();

  async function signIn(): Promise<void> {
    if (!stationToken || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await stationApi.claim(stationToken, serviceNumber.trim(), password, systemNumberValue, classCode.trim());
      setSession(res.studentToken, { id: res.userId, serviceNumber: res.serviceNumber, fullName: res.fullName });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  function onEnter(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') void signIn();
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Sign in to your seat</CardTitle>
          <CardDescription>Enter your login and the classroom code given by your teacher.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="student-service-number">Service number</Label>
            <Input
              id="student-service-number"
              autoFocus
              value={serviceNumber}
              onChange={(e) => setServiceNumber(e.target.value)}
              placeholder="e.g. STU-014"
              onKeyDown={onEnter}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="student-password">Password</Label>
            <Input id="student-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="student-system-number">System number</Label>
            <Input
              id="student-system-number"
              inputMode="numeric"
              value={systemNumber}
              onChange={(e) => setSystemNumber(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="1-40"
              onKeyDown={onEnter}
            />
            <p className="text-xs text-muted-foreground">The number written on this computer's screen.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="student-class-code">Classroom code</Label>
            <Input
              id="student-class-code"
              value={classCode}
              onChange={(e) => setClassCode(e.target.value.toUpperCase())}
              placeholder="e.g. AB3F7K"
              className="uppercase tracking-widest"
              onKeyDown={onEnter}
            />
            <p className="text-xs text-muted-foreground">Given by your teacher.</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" onClick={() => void signIn()} disabled={busy || !canSubmit}>
            {!stationToken ? 'Connecting to the lab server…' : busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
