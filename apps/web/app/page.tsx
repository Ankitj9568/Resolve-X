'use client';
// apps/web/app/page.tsx
// Role selection landing page.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuthStore } from '../store/auth';
import { demoLogin } from '../utils/api';
import type { ApiErrorLike } from '../utils/types';
 
const DEMO_MODE = process.env.NEXT_PUBLIC_MODE === 'demo';
 
const ROLES = [
  {
    id:       'citizen',
    label:    'Citizen',
    desc:     'File a complaint or track your submission',
    icon:     '🏙️',
    href:     '/auth/citizen',
  },
  {
    id:       'officer',
    label:    'Municipal Officer',
    desc:     'View assigned tasks and update field status',
    icon:     '👷',
    href:     '/auth/staff',
  },
  {
    id:       'dept_head',
    label:    'Dept Head',
    desc:     'Monitor department workload and SLA compliance',
    icon:     '📋',
    href:     '/auth/staff',
  },
  {
    id:       'commissioner',
    label:    'Commissioner',
    desc:     'City-wide command centre and risk intelligence',
    icon:     '🏛️',
    href:     '/auth/staff',
  },
];
 
export default function RolePicker() {
  const router    = useRouter();
  const { setToken, setRole } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
 
  const handleDemoLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const { token } = await demoLogin();
      setToken(token);
      setRole('citizen');
      router.push('/citizen/home');
    } catch (err) {
      const apiError = err as ApiErrorLike;
      setError(apiError.message ?? 'Demo login failed');
    } finally {
      setLoading(false);
    }
  };
 
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      {/* Brand */}
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold text-indigo-600 tracking-tight mb-2">ResolveX</h1>
        <p className="text-gray-500 text-sm">
          Smart Public Service CRM · Citizen complaints → urban intelligence
        </p>
      </div>
 
      {/* Role cards */}
      <div className="w-full max-w-md space-y-3">
        {ROLES.map(role => (
          <button
            key={role.id}
            onClick={() => router.push(role.href)}
            className="w-full flex items-center gap-4 px-5 py-4 bg-white border border-gray-200
                       rounded-2xl hover:border-indigo-300 hover:bg-indigo-50
                       transition-all text-left active:scale-[0.98]"
          >
            <span className="text-2xl">{role.icon}</span>
            <div>
              <p className="font-semibold text-gray-900">{role.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{role.desc}</p>
            </div>
          </button>
        ))}
      </div>
 
      {/* Guest track path — no auth required */}
      <div className="mt-6">
        <button
          onClick={() => {
            const id = prompt('Enter your complaint ID to track it:');
            if (id?.trim()) router.push(`/track/${id.trim()}`);
          }}
          className="text-sm text-indigo-500 hover:underline"
        >
          Track complaint without signing in →
        </button>
      </div>
 
      {/* Demo citizen button — DEMO_MODE only */}
      {DEMO_MODE && (
        <div className="mt-8 w-full max-w-md">
          <div className="border-t border-dashed border-amber-300 pt-6">
            <button
              onClick={handleDemoLogin}
              disabled={loading}
              className="w-full py-3.5 px-4 bg-amber-400 hover:bg-amber-500
                         text-amber-900 font-semibold rounded-2xl transition-all
                         active:scale-[0.98] disabled:opacity-60
                         flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-amber-700 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span>⚡</span>
              )}
              {loading ? 'Signing in…' : 'Try as Demo Citizen'}
            </button>
            <p className="text-xs text-center text-amber-700 mt-2">
              Sandbox mode · No OTP required · For exhibition only
            </p>
          </div>
        </div>
      )}
 
      {error && (
        <p className="mt-4 text-sm text-red-600 text-center">{error}</p>
      )}
    </main>
  );
}
