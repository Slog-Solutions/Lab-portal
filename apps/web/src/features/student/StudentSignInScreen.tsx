import { useState } from 'react';
import { stationApi } from '../../lib/station-api';
import { useStudentSession } from '../../stores/student-session-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * The student login page, shown full-screen on an idle seat. Deliberately
 * NOT a route guard: StudentConsole always mounts (and always connects
 * StationControlClient) regardless of sign-in state, because gating
 * /student itself was a real regression once (see router.tsx's doc
 * comment) — the station runtime, broadcast, and remote control must keep
 * working on a signed-out seat. This component only covers the content
 * area; StudentConsole still renders its own header and toast, and the
 * hidden <video>/<audio> elements around it.
 *
 * Three required fields: service number, password and system number (the
 * number written on this PC's own screen — becomes its seat number with no
 * admin step, see StationsService.claim). There is deliberately NO class
 * code here: a student's own credentials are all it takes to reach their
 * dashboard (assignments, study material, joining a class). Joining a
 * teacher's class happens afterwards, from the drawer — by batch code + key
 * on My Classes, or a live class code on Live Class. `stationToken` is the
 * seat's own credential, minted at station:hello — a sign-in can't be sent
 * before it exists, so the button stays disabled until StudentConsole
 * passes one down (see its onToken wiring).
 */
export function StudentSignInScreen({
  stationToken,
  defaultSystemNumber,
  seatText,
}: {
  stationToken: string | null;
  defaultSystemNumber: number | null;
  seatText: string | null;
}) {
  const setSession = useStudentSession((s) => s.setSession);
  const [serviceNumber, setServiceNumber] = useState('');
  const [password, setPassword] = useState('');
  const [systemNumber, setSystemNumber] = useState(defaultSystemNumber !== null ? String(defaultSystemNumber) : '');
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
    systemNumberValue <= 40;

  async function signIn(): Promise<void> {
    if (!stationToken || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await stationApi.claim(stationToken, serviceNumber.trim(), password, systemNumberValue);
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
    <div className="flex min-h-[80vh] w-full flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold">Digital Language Lab</h2>
        <p className="mt-1 text-sm text-muted-foreground">ACTC · No 2 TRG BN · ASC Centre (South)</p>
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Student sign in</CardTitle>
          <CardDescription>
            {seatText ? `${seatText} · ` : ''}Enter your login and the number on this computer's screen.
          </CardDescription>
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" onClick={() => void signIn()} disabled={busy || !canSubmit}>
            {!stationToken ? 'Connecting to the lab server…' : busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
