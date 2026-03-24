'use client';
// apps/web/app/auth/citizen/page.tsx
// Citizen login — phone OTP flow with Google OAuth option.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/auth';
import { requestOtp, verifyOtp } from '../../../utils/api';
import type { ApiErrorLike } from '../../../utils/types';

type Step = 'phone' | 'otp';

export default function CitizenAuth() {
  const router = useRouter();
  const { setToken, setRole } = useAuthStore();

  const [step, setStep]       = useState<Step>('phone');
  const [phone, setPhone]     = useState('');
  const [otp, setOtp]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);

  const startResendTimer = () => {
    setResendTimer(30);
    const t = setInterval(() => {
      setResendTimer(prev => { if (prev <= 1) { clearInterval(t); return 0; } return prev - 1; });
    }, 1000);
  };

  const handleRequestOtp = async () => {
    const cleaned = phone.trim().replace(/\s/g, '');
    if (!/^\+?[0-9]{10,13}$/.test(cleaned)) {
      setError('Enter a valid phone number');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await requestOtp(cleaned);
      setPhone(cleaned);
      setStep('otp');
      startResendTimer();
    } catch (err) {
      const apiError = err as ApiErrorLike;
      setError(apiError.message ?? 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) { setError('Enter the 6-digit code'); return; }
    setLoading(true);
    setError(null);
    try {
      const { token } = await verifyOtp(phone, otp);
      setToken(token);
      setRole('citizen');
      router.push('/citizen/home');
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
          {step === 'phone' ? 'Sign in as Citizen' : 'Enter OTP'}
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          {step === 'phone'
            ? 'We\'ll send a 6-digit code to your phone'
            : `Code sent to ${phone}`}
        </p>

        {/* Phone step */}
        {step === 'phone' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mobile number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRequestOtp()}
                placeholder="+91 98765 43210"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={handleRequestOtp}
              disabled={loading}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium
                         hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Sending…' : 'Send OTP'}
            </button>
          </div>
        )}

        {/* OTP step */}
        {step === 'otp' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                6-digit code
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()}
                placeholder="123456"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm
                           tracking-widest text-center text-xl font-mono
                           focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={handleVerifyOtp}
              disabled={loading}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium
                         hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <div className="text-center">
              {resendTimer > 0 ? (
                <p className="text-sm text-gray-400">Resend in {resendTimer}s</p>
              ) : (
                <button
                  onClick={() => { setStep('phone'); setOtp(''); setError(null); }}
                  className="text-sm text-indigo-500 hover:underline"
                >
                  Resend OTP
                </button>
              )}
            </div>
          </div>
        )}

        {/* Dev hint */}
        {process.env.NODE_ENV !== 'production' && (
          <p className="mt-8 text-xs text-center text-gray-400">
            Staging OTP: <span className="font-mono">123456</span>
          </p>
        )}
      </div>
    </main>
  );
}
