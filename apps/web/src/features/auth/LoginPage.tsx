import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../../lib/api-client';
import { useAuthStore } from '../../stores/auth-store';

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl bg-slate-900 p-8 shadow-xl">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">Digital Language Lab</h1>
          <p className="mt-1 text-sm text-slate-400">ACTC · No 2 TRG BN · ASC Centre (South)</p>
        </div>
        <label className="block text-sm text-slate-300">
          Service Number
          <input
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-slate-50 outline-none focus:border-sky-500"
            value={serviceNumber}
            onChange={(e) => setServiceNumber(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label className="block text-sm text-slate-300">
          Password
          <input
            type="password"
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-slate-50 outline-none focus:border-sky-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-sky-600 py-2 font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
