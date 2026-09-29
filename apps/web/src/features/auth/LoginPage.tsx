import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../../lib/api-client';
import { useAuthStore } from '../../stores/auth-store';
import { AlertCircle, Eye, EyeOff, Film, Loader2, Lock, Mic, Radio, User } from 'lucide-react';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
// Vendored (not hot-linked) — the deployment is air-gapped. Recoloured from
// Storyset's #407BFF to --color-brand-muted; see THIRD-PARTY-NOTICES.md.
import loginIllustrationUrl from '@/assets/illustrations/mobile-login.svg';

interface LoginResponse {
  accessToken: string;
  user: { id: string; role: 'ADMIN' | 'TEACHER' | 'STUDENT'; fullName: string };
}

const HIGHLIGHTS = [
  { icon: Radio, label: 'Live classes' },
  { icon: Mic, label: 'Pronunciation practice' },
  { icon: Film, label: 'Class recordings' },
] as const;

export function LoginPage() {
  const [serviceNumber, setServiceNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ serviceNumber: serviceNumber.trim(), password }),
      });
      setSession(res.accessToken, res.user);
      navigate(res.user.role === 'STUDENT' ? '/student' : '/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed — check the server connection');
    } finally {
      setLoading(false);
    }
  }

  function trackCapsLock(e: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState('CapsLock'));
  }

  return (
    // Locked to the viewport on desktop so the page never scrolls; the
    // illustration shrinks to fit instead of pushing the panel taller.
    <div className="grid min-h-dvh bg-canvas text-foreground lg:h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-4 lg:overflow-hidden lg:p-4">
      {/* ---- Left: sign-in ------------------------------------------- */}
      <div className="flex min-h-dvh flex-col px-6 sm:px-12 lg:min-h-0">
        <main className="flex flex-1 items-center py-8">
          <div className="mx-auto w-full max-w-[400px]">
            <BrandLogo variant="full" className="mx-auto mb-8 w-48" />
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Sign in to your console</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter your service number and password to continue.
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="serviceNumber">
                  Service number
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="serviceNumber"
                    name="username"
                    autoComplete="username"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="h-12 bg-card pl-10 text-[15px] shadow-none"
                    value={serviceNumber}
                    onChange={(e) => setServiceNumber(e.target.value)}
                    placeholder="e.g. TCH-001"
                    aria-invalid={!!error || undefined}
                    autoFocus
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="password">
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="h-12 bg-card pl-10 pr-12 text-[15px] shadow-none"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={trackCapsLock}
                    onKeyUp={trackCapsLock}
                    onBlur={() => setCapsLock(false)}
                    placeholder="Enter your password"
                    aria-invalid={!!error || undefined}
                    aria-describedby={capsLock ? 'caps-lock-hint' : undefined}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {capsLock && (
                  <p id="caps-lock-hint" className="text-xs font-medium text-status-pending">
                    Caps Lock is on
                  </p>
                )}
              </div>

              <div aria-live="polite">
                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-control border border-destructive/25 bg-destructive/[0.06] px-3.5 py-3 text-sm text-destructive"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <Button type="submit" disabled={loading} className="h-12 w-full text-[15px] font-semibold">
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" />
                    <span>Signing in…</span>
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>

            <p className="mt-6 text-sm text-muted-foreground">
              Forgot your password?{' '}
              <span className="font-medium text-foreground">Contact your lab administrator.</span>
            </p>
          </div>
        </main>
      </div>

      {/* ---- Right: illustration panel (desktop only) ------------------ */}
      <aside className="relative hidden overflow-hidden rounded-card bg-brand-soft lg:flex lg:flex-col">
        {/* Soft cream blob behind the artwork, echoing the brand's two colours. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-[34rem] w-[34rem] rounded-full bg-cream/70"
        />

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-10 pt-8">
          <img
            src={loginIllustrationUrl}
            alt=""
            aria-hidden
            draggable={false}
            className="h-full max-h-[520px] w-full max-w-[520px] select-none object-contain"
          />
        </div>

        <div className="relative shrink-0 px-12 pb-8">
          <h2 className="max-w-md text-2xl font-semibold leading-snug tracking-tight text-brand">
            Every voice in the lab, one console.
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Run live sessions, assign speaking practice and review every recording from a single place.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-2 rounded-pill border border-hairline bg-card/70 px-3.5 py-1.5 text-xs font-medium text-brand"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[11px] text-muted-foreground/80">Illustration by Storyset (storyset.com)</p>
        </div>
      </aside>
    </div>
  );
}
