'use client';
// apps/web/app/auth/staff/page.tsx
// Staff login — employee ID + password, then TOTP 2FA.
// Covers officer, dept_head, and commissioner roles.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/auth';
import type { ApiErrorLike } from '../../../utils/types';

type Step = 'credentials' | 'totp';

const BASE = process.env.NEXT_PUBLIC_API_URL;

async function staffLogin(employee_id: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ employee_id, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Login failed');
  return data; // { partial_session: true, user_id }
}

async function staffLogin2fa(user_id: string, totp: string) {
  const res = await fetch(`${BASE}/auth/login/2fa`, {
    method:      'POST',
    headers:     { 'Content-Type': 'application/json' },
    credentials: 'include', // receives HttpOnly refresh cookie
    body:        JSON.stringify({ user_id, totp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Invalid code');
  return data; // { token, user: { role } }
}

const ROLE_LANDING: Record<string, string> = {
  officer:      '/officer/tasks',
  dept_head:    '/admin/dept',
  commissioner: '/admin/command',
};

export default function StaffAuth() {
  const router = useRouter();
  const { setToken, setRole } = useAuthStore();

  const [step, setStep]           = useState<Step>('credentials');
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword]   = useState('');
  const [totp, setTotp]           = useState('');
  const [userId, setUserId]       = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleCredentials = async () => {
    if (!employeeId.trim() || !password) {
      setError('Enter your employee ID and password');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await staffLogin(employeeId.trim(), password);
      setUserId(data.user_id);
      setStep('totp');
    } catch (err) {
      const apiError = err as ApiErrorLike;
      setError(apiError.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleTotp = async () => {
    if (totp.length !== 6) { setError('Enter the 6-digit authenticator code'); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await staffLogin2fa(userId, totp);
      setToken(data.token);
      setRole(data.user.role);
      router.push(ROLE_LANDING[data.user.role] ?? '/admin/dashboard');
    } catch (err) {
      const apiError = err as ApiErrorLike;
      setError(apiError.message ?? 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
      <div className="w-full max-w-sm">
        <button onClick={() => router.push('/')}
          className="text-sm text-indigo-500 hover:underline mb-6 block">
          ← Back
        </button>

        <h1 className="text-2xl font-semibold text-gray-900 mb-1">
          {step === 'credentials' ? 'Staff Login' : 'Two-factor authentication'}
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          {step === 'credentials'
            ? 'Use your government employee ID and password'
            : 'Enter the 6-digit code from your authenticator app'}
        </p>

        {/* Credentials step */}
        {step === 'credentials' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Employee ID
              </label>
              <input
                type="text"
                value={employeeId}
                onChange={e => setEmployeeId(e.target.value)}
                placeholder="BBMP-W14-DRN-042"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm
                           font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCredentials()}
                  placeholder="••••••••••••"
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-400 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400
                             hover:text-gray-600 text-xs"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={handleCredentials}
              disabled={loading}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium
                         hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Signing in…' : 'Continue'}
            </button>
          </div>
        )}

        {/* TOTP step */}
        {step === 'totp' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Authenticator code
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={totp}
                onChange={e => setTotp(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && handleTotp()}
                placeholder="000000"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm
                           tracking-widest text-center text-xl font-mono
                           focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={handleTotp}
              disabled={loading}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium
                         hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Verifying…' : 'Sign in'}
            </button>
            <p className="text-xs text-center text-gray-400 mt-2">
              Open Google Authenticator or Authy to get your code
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
