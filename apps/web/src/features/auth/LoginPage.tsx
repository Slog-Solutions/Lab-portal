import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../../lib/api-client';
import { useAuthStore } from '../../stores/auth-store';
import { ArrowRight, Lock, User } from 'lucide-react';

interface LoginResponse {
  accessToken: string;
  user: { id: string; role: 'ADMIN' | 'TEACHER' | 'STUDENT'; fullName: string };
}

export function LoginPage() {
  const [serviceNumber, setServiceNumber] = useState('');
  const [password, setPassword] = useState('');
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
        body: JSON.stringify({ serviceNumber, password }),
      });
      setSession(res.accessToken, res.user);
      navigate(res.user.role === 'STUDENT' ? '/student' : '/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed — check the server connection');
    } finally {
      setLoading(false);
    }
  }

  function fillDemo(user: 'teacher' | 'admin') {
    if (user === 'teacher') {
      setServiceNumber('TCH-001');
      setPassword('Teacher@12345');
    } else {
      setServiceNumber('ADMIN-001');
      setPassword('Admin@12345');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#A9AF98] p-4">
      <div className="w-full max-w-md rounded-[28px] border border-[rgba(20,21,15,0.08)] bg-[#F4F4EF] p-8 text-[#14150F] shadow-none">
        <div className="mb-6 border-b border-[rgba(20,21,15,0.08)] pb-5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#D7F83C] ring-2 ring-[#17181A]" />
            <h1 className="text-xl font-semibold tracking-tight text-[#14150F]">Digital Language Lab</h1>
          </div>
          <p className="mt-1 text-xs text-[#6E7066]">ACTC · No 2 TRG BN · ASC Centre (South)</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#14150F]">Service number</label>
            <div className="relative flex items-center">
              <input
                className="w-full rounded-2xl border border-[rgba(20,21,15,0.12)] bg-[#E5E8DC]/50 py-2.5 pl-3.5 pr-9 text-sm text-[#14150F] outline-none transition focus:border-[#17181A] focus:bg-white"
                value={serviceNumber}
                onChange={(e) => setServiceNumber(e.target.value)}
                placeholder="e.g. TCH-001 or ADMIN-001"
                autoFocus
                required
              />
              <User className="absolute right-3 h-4 w-4 text-[#6E7066]" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#14150F]">Password</label>
            <div className="relative flex items-center">
              <input
                type="password"
                className="w-full rounded-2xl border border-[rgba(20,21,15,0.12)] bg-[#E5E8DC]/50 py-2.5 pl-3.5 pr-9 text-sm text-[#14150F] outline-none transition focus:border-[#17181A] focus:bg-white"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
              />
              <Lock className="absolute right-3 h-4 w-4 text-[#6E7066]" />
            </div>
          </div>

          {error && <p className="text-xs font-medium text-[#C9503F]">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[#17181A] py-3 text-sm font-semibold text-[#F5F5F0] transition hover:bg-black disabled:opacity-40"
          >
            <span>{loading ? 'Signing in…' : 'Sign in'}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        {/* Quick Demo sign-in helpers */}
        <div className="mt-6 border-t border-[rgba(20,21,15,0.08)] pt-4">
          <p className="mb-2 text-center text-xs text-[#6E7066]">Quick demo sign-in:</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fillDemo('teacher')}
              className="flex-1 rounded-full border border-[rgba(20,21,15,0.12)] bg-black/5 py-1.5 text-xs font-medium text-[#14150F] hover:bg-black/10"
            >
              Teacher (TCH-001)
            </button>
            <button
              type="button"
              onClick={() => fillDemo('admin')}
              className="flex-1 rounded-full border border-[rgba(20,21,15,0.12)] bg-black/5 py-1.5 text-xs font-medium text-[#14150F] hover:bg-black/10"
            >
              Admin (ADMIN-001)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
