'use client';

import { useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useComplaintDraft } from '../../store/complaintDraft';
import { useAuthStore } from '../../store/auth';
import { postComplaint } from '../../utils/api';
import IssueAnalysisCard from '../../components/IssueAnalysisCard';
import type { ApiErrorLike, SecondaryIssue } from '../../utils/types';

// Leaflet must be dynamically imported — it accesses window on load
const LocationPicker = dynamic(
  () => import('../../components/Locationpicker'),
  { ssr: false, loading: () => <div className="h-64 bg-gray-100 rounded-xl animate-pulse" /> }
);

// ── Category definitions ──────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'CAT-01', label: 'Roads & Footpaths',    icon: '🛣️'  },
  { id: 'CAT-02', label: 'Drainage & Sewage',    icon: '🌊'  },
  { id: 'CAT-03', label: 'Streetlighting',        icon: '💡'  },
  { id: 'CAT-04', label: 'Waste & Sanitation',   icon: '🗑️'  },
  { id: 'CAT-05', label: 'Water Supply',          icon: '🚰'  },
  { id: 'CAT-06', label: 'Parks & Public Space', icon: '🌳'  },
  { id: 'CAT-07', label: 'Encroachment',          icon: '🚧'  },
  { id: 'CAT-08', label: 'Noise & Pollution',    icon: '📢'  },
  { id: 'CAT-09', label: 'Stray Animals',         icon: '🐕'  },
  { id: 'CAT-10', label: 'Other',                 icon: '📋'  },
];

// Demo geo-fence bbox (Bharat Mandapam)
const DEMO_MODE     = process.env.NEXT_PUBLIC_MODE === 'demo';
const DEMO_CENTER   = { lat: 28.6100, lng: 77.2090 };
const DEMO_BBOX     = { latMin: 28.595, latMax: 28.625, lngMin: 77.195, lngMax: 77.225 };

// ── Wizard component ──────────────────────────────────────────────────────────

export default function ComplaintFilingWizard() {
  const router = useRouter();
  const { token } = useAuthStore();

  const {
    category, subcategory, latitude, longitude,
    description, fileUrls,
    setField, reset,
  } = useComplaintDraft();

  const [step, setStep]             = useState(1);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [complaintId, setComplaintId] = useState<string | null>(null);
  const [slaDeadline, setSlaDeadline] = useState<string | null>(null);
  const [, setSecondaryIssues] = useState<SecondaryIssue[]>([]);

  // ── Screen 1: Category ──────────────────────────────────────────────────────

  const Screen1 = () => (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">What is the issue?</h2>
      <p className="text-sm text-gray-500">Select a category to continue</p>
      <div className="grid grid-cols-2 gap-3">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => {
              setField('category', cat.id);
              setStep(2);
            }}
            className={`
              flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all
              ${category === cat.id
                ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50 text-gray-700'
              }
            `}
          >
            <span className="text-2xl">{cat.icon}</span>
            <span className="text-sm font-medium leading-tight">{cat.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Screen 2: Location ──────────────────────────────────────────────────────

  const Screen2 = () => {
    const defaultCenter = DEMO_MODE
      ? DEMO_CENTER
      : { lat: latitude || 28.6100, lng: longitude || 77.2090 };

    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">Where is the issue?</h2>
        <p className="text-sm text-gray-500">
          Drag the pin to the exact location
          {DEMO_MODE && ' · Must stay within demo ward boundary'}
        </p>

        <LocationPicker
          center={defaultCenter}
          demoMode={DEMO_MODE}
          demoBbox={DEMO_BBOX}
          onLocationChange={(lat: number, lng: number) => {
            setField('latitude', lat);
            setField('longitude', lng);
          }}
        />

        <WizardNav
          onBack={() => setStep(1)}
          onNext={() => {
            if (!latitude || !longitude) {
              setError('Please confirm your location on the map');
              return;
            }
            setError(null);
            setStep(3);
          }}
        />
      </div>
    );
  };

  // ── Screen 3: Evidence + IssueAnalysisCard ──────────────────────────────────

  const Screen3 = () => {
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const handleUpload = async (files: FileList) => {
      if (!files.length) return;
      if (fileUrls.length >= 3) {
        setError('Maximum 3 files per complaint');
        return;
      }

      setUploading(true);
      setError(null);

      for (const file of Array.from(files).slice(0, 3 - fileUrls.length)) {
        const form = new FormData();
        form.append('file', file);
        // complaint_id not yet created — upload first, attach on submit
        // Backend accepts uploads without complaint_id and returns a temp URL

        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/media/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          });
          const data = await res.json();
          if (data.file_url) {
            setField('fileUrls', [...fileUrls, data.file_url]);
          }
        } catch {
          setError('Upload failed — please try again');
        }
      }

      setUploading(false);
    };

    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">Add photo evidence</h2>
        <p className="text-sm text-gray-500">Optional · Max 3 files · 10MB each</p>

        {/* Upload area */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || fileUrls.length >= 3}
          className="w-full h-32 border-2 border-dashed border-gray-300 rounded-xl
                     flex flex-col items-center justify-center gap-2 text-gray-400
                     hover:border-indigo-400 hover:text-indigo-500 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading
            ? <span className="text-sm">Uploading…</span>
            : <>
                <span className="text-3xl">📷</span>
                <span className="text-sm">Tap to upload photo or video</span>
              </>
          }
        </button>
        <input
          title="Upload supporting evidence"
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,video/mp4"
          multiple
          className="hidden"
          onChange={e => e.target.files && handleUpload(e.target.files)}
        />

        {/* Uploaded file chips */}
        {fileUrls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {fileUrls.map((url, i) => (
              <span key={i}
                className="text-xs bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full">
                File {i + 1} ✓
              </span>
            ))}
          </div>
        )}

        {/* Multi-issue detection card — shown for selected category */}
        {category && <IssueAnalysisCard category={category as string} />}

        <WizardNav
          onBack={() => setStep(2)}
          onNext={() => { setError(null); setStep(4); }}
          nextLabel="Continue"
        />
      </div>
    );
  };

  // ── Screen 4: Description + Review ─────────────────────────────────────────

  const Screen4 = () => {
    const selectedCat = CATEGORIES.find(c => c.id === category);

    // SLA estimate based on category priority
    const slaLabel = ['CAT-02', 'CAT-05'].includes(category ?? '')
      ? '48 hours'
      : '72 hours';

    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">Review & describe</h2>

        {/* Summary card */}
        <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Category</span>
            <span className="font-medium text-gray-900">{selectedCat?.label}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Location</span>
            <span className="font-medium text-gray-900">
              {latitude?.toFixed(4)}°N, {longitude?.toFixed(4)}°E
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Expected SLA</span>
            <span className="font-medium text-indigo-600">{slaLabel}</span>
          </div>
          {fileUrls.length > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-500">Evidence</span>
              <span className="font-medium text-gray-900">{fileUrls.length} file{fileUrls.length > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {/* Optional description — not mandatory per spec */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Additional details <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            className="w-full border border-gray-300 rounded-xl p-3 text-sm resize-none
                       focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
            rows={3}
            placeholder="Any additional details about the issue…"
            value={description}
            maxLength={500}
            onChange={e => setField('description', e.target.value)}
          />
          <p className="text-xs text-gray-400 text-right mt-1">
            {description.length}/500
          </p>
        </div>

        {error && <ErrorBanner message={error} />}

        <WizardNav
          onBack={() => setStep(3)}
          onNext={handleSubmit}
          nextLabel={loading ? 'Submitting…' : 'Submit complaint'}
          nextDisabled={loading}
        />
      </div>
    );
  };

  // ── Screen 5: Confirmation ──────────────────────────────────────────────────

  const Screen5 = () => (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
          <span className="text-3xl">✅</span>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Complaint filed</h2>
        <p className="text-sm text-gray-500">Your complaint has been submitted successfully</p>
      </div>

      {complaintId && (
        <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm text-left">
          <div className="flex justify-between">
            <span className="text-gray-500">Complaint ID</span>
            <span className="font-mono text-xs text-gray-700 truncate max-w-[160px]">{complaintId}</span>
          </div>
          {slaDeadline && (
            <div className="flex justify-between">
              <span className="text-gray-500">Expected resolution</span>
              <span className="font-medium text-indigo-600">
                {new Date(slaDeadline).toLocaleDateString('en-IN', {
                  day: 'numeric', month: 'short', year: 'numeric'
                })}
              </span>
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => router.push(`/track/${complaintId}`)}
        className="w-full py-3 px-4 bg-indigo-600 text-white rounded-xl font-medium
                   hover:bg-indigo-700 active:scale-[0.98] transition-all"
      >
        Track your complaint
      </button>

      <button
        onClick={() => { reset(); setStep(1); setComplaintId(null); }}
        className="w-full py-3 px-4 border border-gray-200 text-gray-600 rounded-xl
                   font-medium hover:bg-gray-50 transition-colors text-sm"
      >
        File another complaint
      </button>
    </div>
  );

  // ── Submit handler — single POST on screen 4 confirm ─────────────────────

  const handleSubmit = async () => {
    if (!category || !latitude || !longitude) {
      setError('Missing required fields — please go back and complete all steps');
      return;
    }

    if (!token) {
      setError('You are not logged in — please sign in and try again');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await postComplaint({
        category,
        subcategory:  subcategory ?? undefined,
        description:  description || undefined,
        latitude,
        longitude,
        file_urls:    fileUrls,
      }, token);

      setComplaintId(result.complaint_id);
      setSlaDeadline(result.sla_deadline);
      setSecondaryIssues(result.secondary_issues ?? []);
      reset(); // clear draft from store
      setStep(5);
    } catch (err) {
      const apiError = err as ApiErrorLike;
      setError(apiError.message ?? 'Something went wrong — please try again');
    } finally {
      setLoading(false);
    }
  };

  // ── Progress bar ─────────────────────────────────────────────────────────

  const stepLabels = ['Category', 'Location', 'Evidence', 'Review', 'Done'];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-lg mx-auto px-4 py-8">

        {/* Progress indicator */}
        {step < 5 && (
          <div className="mb-8">
            <div className="flex justify-between mb-2">
              {stepLabels.map((label, i) => (
                <span
                  key={label}
                  className={`text-xs font-medium ${
                    i + 1 <= step ? 'text-indigo-600' : 'text-gray-300'
                  }`}
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${((step - 1) / 4) * 100}%` }}
              />
            </div>
          </div>
        )}

        {error && step !== 4 && <ErrorBanner message={error} />}

        {step === 1 && <Screen1 />}
        {step === 2 && <Screen2 />}
        {step === 3 && <Screen3 />}
        {step === 4 && <Screen4 />}
        {step === 5 && <Screen5 />}
      </div>
    </main>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function WizardNav({
  onBack, onNext, nextLabel = 'Next', nextDisabled = false,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div className="flex gap-3 pt-2">
      {onBack && (
        <button
          onClick={onBack}
          className="flex-1 py-3 px-4 border border-gray-200 text-gray-600 rounded-xl
                     font-medium hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
      )}
      <button
        onClick={onNext}
        disabled={nextDisabled}
        className="flex-1 py-3 px-4 bg-indigo-600 text-white rounded-xl font-medium
                   hover:bg-indigo-700 active:scale-[0.98] transition-all
                   disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
      >
        {nextLabel}
      </button>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
      {message}
    </div>
  );
}
