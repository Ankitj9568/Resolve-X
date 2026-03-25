'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import AnimatedTestimonials from '../components/AnimatedTestimonials';
import { useAuthStore } from '../store/auth';
import { demoLogin } from '../utils/api';
import type { ApiErrorLike } from '../utils/types';

const DEMO_MODE = process.env.NEXT_PUBLIC_MODE === 'demo';

const metrics = [
  { value: 99.9, suffix: '%', label: 'Backend Uptime SLA', decimals: 1 },
  { value: 2, prefix: '< ', suffix: 's', label: 'AI Categorization Latency', decimals: 0 },
  { value: 10, suffix: '+', label: 'Native Civic Domains Supported', decimals: 0 },
  { value: 85, suffix: '%', label: 'Reduction in Duplicate Reports', decimals: 0 },
] as const;

const features = [
  {
    eyebrow: 'Geospatial Mastery',
    title: 'Stop duplicate tickets at the source.',
    body: 'Our PostGIS engine detects when a complaint lands within 50 meters of an active issue filed in the last 48 hours, preventing operational noise before it spreads.',
    accent: 'from-emerald-400/30 to-cyan-400/10',
  },
  {
    eyebrow: 'Neural LLM Routing',
    title: 'Send every report to the right desk on first touch.',
    body: 'Natural language analysis interprets citizen text, classifies the issue, and maps it to the precise department workflow without manual triage bottlenecks.',
    accent: 'from-sky-400/30 to-indigo-400/10',
  },
  {
    eyebrow: 'Predictive Radar',
    title: 'Cluster signals before they become citywide incidents.',
    body: 'DBSCAN turns scattered complaints into macro-patterns, helping municipal teams see flood risk, traffic failures, and sanitation hotspots before they escalate.',
    accent: 'from-amber-400/30 to-orange-400/10',
  },
] as const;

const architecture = [
  {
    id: 'ingestion',
    label: 'Layer 1. Ingestion',
    title: 'Citizen PWA intake with zero-spam guardrails.',
    body: 'Mobile-first capture flows accept text, geotagged images, and issue metadata while magic-byte validation and structured inputs keep uploads trustworthy.',
    chips: ['Citizen PWA', 'Geo Capture', 'Media Validation'],
    panelTitle: 'Field capture stream',
  },
  {
    id: 'orchestration',
    label: 'Layer 2. Orchestration',
    title: 'Durable queues keep surges from becoming outages.',
    body: 'RabbitMQ priority routing decouples ingestion from classification, rate limits abusive patterns, and preserves service reliability during mass-reporting events.',
    chips: ['RabbitMQ', 'Priority Routing', 'Burst Control'],
    panelTitle: 'Queue orchestration fabric',
  },
  {
    id: 'execution',
    label: 'Layer 3. Execution',
    title: 'A live command center for officers, department heads, and commissioners.',
    body: 'Leaflet-powered operational views combine SLA countdowns, heatmaps, and early-warning overlays so every team sees what matters now.',
    chips: ['Leaflet.js', 'Heatmaps', 'SLA Views'],
    panelTitle: 'Commissioner command center',
  },
] as const;

const securityCards = [
  {
    title: 'Authentication',
    body: 'RS256 asymmetric JWTs, strict RBAC boundaries, bcrypt OTP hashing, and TOTP-based step-up authentication protect privileged workflows.',
  },
  {
    title: 'Data Sovereignty',
    body: 'ResolveX can be deployed fully on-premise through Docker Compose for municipal environments with strict residency and procurement controls.',
  },
  {
    title: 'Resilience',
    body: 'High-throughput message buffering absorbs spikes in reporting volume, preventing timeout cascades during weather events or public emergencies.',
  },
] as const;

const integrations = [
  'NVIDIA NIM',
  'Meta Llama 3',
  'PostgreSQL',
  'Node.js',
  'Next.js',
  'RabbitMQ',
  'Redis',
  'MinIO',
  'Docker',
  'AWS',
] as const;

const portalCards = [
  {
    title: 'Citizen',
    body: 'File issues, attach evidence, and track case progress in real time through the public-facing complaint portal.',
    href: '/auth/citizen',
  },
  {
    title: 'Municipal Officer',
    body: 'Receive assignments, inspect cases in the field, and update operational status without leaving the workflow.',
    href: '/auth/staff?next=/officer/tasks',
  },
  {
    title: 'Dept Head',
    body: 'Monitor department workload, SLA pressure, and queue health across active civic issue categories.',
    href: '/auth/staff?next=/admin/dept',
  },
  {
    title: 'Commissioner',
    body: 'Get a citywide command view with hotspot visibility, trend signals, and live operational oversight.',
    href: '/auth/staff?next=/admin/map',
  },
] as const;

function CountMetric({
  value,
  prefix = '',
  suffix = '',
  label,
  decimals = 0,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  label: string;
  decimals?: number;
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;

    const duration = 900;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(value * eased);
      if (progress < 1) {
        window.requestAnimationFrame(tick);
      }
    };

    const frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [started, value]);

  return (
    <div
      ref={ref}
      className="rounded-[2rem] border border-white/8 bg-white/[0.03] p-6 backdrop-blur-md shadow-[0_20px_80px_rgba(0,0,0,0.35)]"
    >
      <div className="text-3xl font-semibold text-white md:text-4xl">
        <span className="text-[var(--signal-blue)]">{prefix}</span>
        {displayValue.toFixed(decimals)}
        {suffix}
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--grey-text-light)]">{label}</p>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { setToken, setRole } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState(0);
  const architectureRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const updateLayer = () => {
      const section = architectureRef.current;
      if (!section) return;

      const rect = section.getBoundingClientRect();
      const viewport = window.innerHeight;
      const usable = Math.max(1, rect.height - viewport);
      const progress = Math.min(1, Math.max(0, (viewport * 0.2 - rect.top) / usable));
      const index = Math.min(
        architecture.length - 1,
        Math.max(0, Math.round(progress * (architecture.length - 1)))
      );

      setActiveLayer(index);
    };

    updateLayer();
    window.addEventListener('scroll', updateLayer, { passive: true });
    window.addEventListener('resize', updateLayer);
    return () => {
      window.removeEventListener('scroll', updateLayer);
      window.removeEventListener('resize', updateLayer);
    };
  }, []);

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

  const handleTrackIssue = () => {
    const id = window.prompt('Enter your complaint ID to track it:');
    if (id?.trim()) {
      router.push(`/track/${id.trim()}`);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--main-dark-bg)] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(50,110,255,0.09),_transparent_26%),radial-gradient(circle_at_18%_18%,_rgba(0,214,140,0.08),_transparent_22%),radial-gradient(circle_at_84%_26%,_rgba(255,189,89,0.08),_transparent_20%)]" />
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-20" />
      <div className="absolute left-1/2 top-[-10rem] h-[22rem] w-[22rem] -translate-x-1/2 rounded-full bg-[var(--signal-blue)]/12 blur-[120px]" />
      <div className="absolute left-[12%] top-[24rem] h-[16rem] w-[16rem] rounded-full bg-emerald-400/8 blur-[120px]" />
      <div className="absolute right-[10%] top-[34rem] h-[14rem] w-[14rem] rounded-full bg-amber-300/8 blur-[110px]" />

      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20 pt-6 md:px-8 md:pb-28 md:pt-8">
        <nav className="flex items-center justify-between gap-4 rounded-full border border-white/8 bg-white/[0.03] px-4 py-3 md:px-6">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logo.png" alt="ResolveX" width={36} height={36} className="h-9 w-9 object-contain" />
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.22em] text-white/80">ResolveX</div>
              <div className="text-xs text-[var(--grey-text-dark)]">Urban intelligence platform</div>
            </div>
          </Link>
          <div className="hidden items-center gap-6 text-sm text-[var(--grey-text-light)] lg:flex">
            <a href="#platform" className="transition-colors hover:text-white">Platform</a>
            <a href="#architecture" className="transition-colors hover:text-white">Architecture</a>
            <a href="#security" className="transition-colors hover:text-white">Security</a>
            <a href="#integrations" className="transition-colors hover:text-white">Integrations</a>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleTrackIssue}
              className="hidden rounded-full border border-white/10 px-4 py-2 text-sm text-white/90 transition hover:border-white/18 hover:bg-white/5 sm:block"
            >
              Track Issue
            </button>
            <Link
              href="/auth/staff"
              className="rounded-full bg-[var(--signal-blue)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#4d8cff]"
            >
              Staff Access
            </Link>
          </div>
        </nav>

        <div className="grid items-center gap-14 pb-18 pt-14 md:pb-22 md:pt-20 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/8 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200">
              New: EternaCloud Intelligence Engine 2.0
            </div>
            <h1 className="mt-7 max-w-4xl text-5xl font-semibold leading-[0.95] tracking-[-0.05em] text-white md:text-7xl">
              Urban Intelligence. Powered by AI.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-[var(--grey-text-light)] md:text-xl">
              Transform municipal operations overnight. ResolveX fuses PostGIS spatial caching with native LLM classification to automatically detect, route, and resolve city infrastructure issues instantly.
            </p>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <Link
                href="/auth/staff"
                className="inline-flex items-center justify-center rounded-full bg-[var(--signal-blue)] px-7 py-3.5 text-sm font-semibold text-white transition hover:translate-y-[-1px] hover:bg-[#4d8cff]"
              >
                Schedule a Demo
              </Link>
              <Link
                href="/admin/map"
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-7 py-3.5 text-sm font-semibold text-white transition hover:border-white/18 hover:bg-white/[0.06]"
              >
                View Live Map
              </Link>
            </div>
            <div className="mt-10 grid gap-4 text-sm text-[var(--grey-text-light)] sm:grid-cols-3">
              <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.02] p-4">
                PostGIS duplicate suppression
              </div>
              <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.02] p-4">
                Native LLM issue classification
              </div>
              <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.02] p-4">
                Heatmaps and predictive clustering
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-x-[12%] top-[10%] h-[62%] rounded-full bg-[var(--signal-blue)]/10 blur-[90px]" />
            <div className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-3 shadow-[0_18px_56px_rgba(0,0,0,0.28)]">
              <div className="rounded-[1.3rem] border border-white/8 bg-[#08111f] p-4">
                <div className="flex items-center justify-between border-b border-white/8 pb-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.26em] text-[var(--grey-text-dark)]">Realtime command fabric</p>
                    <h2 className="mt-2 text-2xl font-semibold text-white">Citywide incident map</h2>
                  </div>
                  <div className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                    Live orchestration
                  </div>
                </div>
                <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="relative min-h-[22rem] overflow-hidden rounded-[1.3rem] border border-cyan-400/10 bg-[linear-gradient(180deg,#081727,#09111b)]">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_24%,rgba(54,214,178,0.22),transparent_18%),radial-gradient(circle_at_68%_34%,rgba(69,125,255,0.28),transparent_20%),radial-gradient(circle_at_58%_68%,rgba(255,189,89,0.2),transparent_18%)]" />
                    <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'linear-gradient(rgba(138,164,197,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(138,164,197,0.12) 1px, transparent 1px)', backgroundSize: '56px 56px' }} />
                    <div className="absolute left-[18%] top-[34%] h-4 w-4 rounded-full bg-emerald-300 shadow-[0_0_0_10px_rgba(52,211,153,0.18)]" />
                    <div className="absolute left-[48%] top-[28%] h-4 w-4 rounded-full bg-sky-300 shadow-[0_0_0_14px_rgba(96,165,250,0.16)]" />
                    <div className="absolute left-[62%] top-[55%] h-4 w-4 rounded-full bg-amber-300 shadow-[0_0_0_12px_rgba(252,211,77,0.14)]" />
                    <div className="absolute bottom-5 left-5 rounded-xl border border-white/8 bg-slate-950/78 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.25em] text-[var(--grey-text-dark)]">Hotspot cluster</div>
                      <div className="mt-1 text-lg font-semibold text-white">Ward 11 flood-risk surge</div>
                    </div>
                  </div>
                  <div className="grid gap-4">
                    <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.03] p-5">
                      <div className="text-xs uppercase tracking-[0.24em] text-[var(--grey-text-dark)]">AI Queue</div>
                      <div className="mt-3 text-3xl font-semibold text-white">2,941</div>
                      <p className="mt-2 text-sm leading-6 text-[var(--grey-text-light)]">Requests ingested, deduped, and routed through municipal workflows in the last 24 hours.</p>
                    </div>
                    <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.03] p-5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase tracking-[0.24em] text-[var(--grey-text-dark)]">SLA Pulse</span>
                        <span className="text-xs font-medium text-emerald-300">Stable</span>
                      </div>
                      <div className="mt-4 space-y-3">
                        {[78, 61, 43].map((width, index) => (
                          <div key={width}>
                            <div className="mb-1 flex justify-between text-xs text-[var(--grey-text-light)]">
                              <span>{['Roads', 'Drainage', 'Sanitation'][index]}</span>
                              <span>{width}% within SLA</span>
                            </div>
                            <div className="h-2 rounded-full bg-white/8">
                              <div className="h-2 rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-cyan-300" style={{ width: `${width}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-[1.25rem] border border-amber-300/10 bg-amber-300/5 p-5">
                      <div className="text-xs uppercase tracking-[0.24em] text-amber-100/70">Early Warning</div>
                      <p className="mt-2 text-sm leading-6 text-amber-50">
                        Complaint density indicates a 3.2x drainage anomaly near Ring Road before monsoon threshold conditions.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
<section className="relative z-10 mx-auto max-w-7xl px-6 py-12 md:px-8">
        <div className="grid gap-6 lg:grid-cols-4">
          {portalCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="rounded-[1.25rem] border border-white/8 bg-[var(--secondary-dark)] p-6 shadow-[0_12px_36px_rgba(0,0,0,0.16)] transition hover:-translate-y-1 hover:border-white/14"
            >
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--grey-text-dark)]">Platform layer</div>
              <h3 className="mt-3 text-xl font-semibold text-white">{card.title}</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--grey-text-light)]">{card.body}</p>
            </Link>
          ))}
        </div>
      </section>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <CountMetric key={metric.label} {...metric} />
          ))}
        </section>
      </section>

      <section id="platform" className="relative z-10 mx-auto max-w-7xl px-6 py-10 md:px-8 md:py-16">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-cyan-200/80">Why ResolveX</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white md:text-5xl">
            Enterprise controls for cities that cannot afford operational blind spots.
          </h2>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="group overflow-hidden rounded-[1.5rem] border border-white/8 bg-[var(--secondary-dark)] shadow-[0_14px_40px_rgba(0,0,0,0.18)] transition duration-300 hover:-translate-y-1 hover:border-white/14"
            >
              <div className={`h-32 bg-gradient-to-br ${feature.accent}`} />
              <div className="p-7">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--grey-text-dark)]">{feature.eyebrow}</p>
                <h3 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">{feature.title}</h3>
                <p className="mt-4 text-sm leading-7 text-[var(--grey-text-light)]">{feature.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        id="architecture"
        ref={architectureRef}
        className="relative z-10 mx-auto grid max-w-7xl gap-10 px-6 py-16 md:px-8 lg:grid-cols-[0.9fr_1.1fr]"
      >
        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-emerald-200/80">How it works</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white md:text-5xl">
            One architecture, three operational layers.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-[var(--grey-text-light)]">
            Scroll through the ResolveX stack from citizen capture to command-center execution. The left rail stays anchored while the active operational layer expands on the right.
          </p>
          <div className="mt-8 space-y-4">
            {architecture.map((item, index) => {
              const isActive = activeLayer === index;
              return (
                <div
                  key={item.id}
                  className={`rounded-[1.35rem] border px-5 py-4 transition duration-300 ${
                    isActive
                      ? 'border-white/14 bg-white/[0.04] shadow-[0_12px_34px_rgba(0,0,0,0.16)]'
                      : 'border-white/6 bg-white/[0.02] text-white/80'
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--grey-text-dark)]">{item.label}</p>
                  <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--grey-text-light)]">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          {architecture.map((item, index) => {
            const isActive = activeLayer === index;
            return (
              <article
                key={item.id}
                className={`min-h-[28rem] overflow-hidden rounded-[1.5rem] border p-6 transition duration-500 md:p-8 ${
                  isActive
                    ? 'scale-[1.005] border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] opacity-100 shadow-[0_16px_48px_rgba(0,0,0,0.2)]'
                    : 'border-white/6 bg-white/[0.025] opacity-45'
                }`}
              >
                <div className="flex flex-wrap gap-2">
                  {item.chips.map((chip) => (
                    <span key={chip} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-medium text-[var(--grey-text-light)]">
                      {chip}
                    </span>
                  ))}
                </div>
                <div className="mt-6 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                  <div>
                    <p className="text-xs uppercase tracking-[0.26em] text-[var(--grey-text-dark)]">{item.panelTitle}</p>
                    <h3 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">{item.title}</h3>
                    <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--grey-text-light)]">{item.body}</p>
                  </div>
                  <div className="rounded-[1.25rem] border border-white/8 bg-[#08111f] p-4">
                    <div className="space-y-3">
                      <div className="rounded-[1rem] border border-white/8 bg-white/[0.025] p-4">
                        <div className="text-xs uppercase tracking-[0.24em] text-[var(--grey-text-dark)]">Input integrity</div>
                        <div className="mt-2 text-lg font-semibold text-white">{index === 0 ? 'Magic-byte validation' : index === 1 ? 'Priority queue handling' : 'Officer alert routing'}</div>
                      </div>
                      <div className="rounded-[1rem] border border-white/8 bg-white/[0.025] p-4">
                        <div className="text-xs uppercase tracking-[0.24em] text-[var(--grey-text-dark)]">Operational note</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--grey-text-light)]">
                          {index === 0
                            ? 'Citizen reports enter a structured pipeline with trusted media and location metadata.'
                            : index === 1
                              ? 'Back-pressure handling protects the classification layer while preserving auditability.'
                              : 'Decision-makers act from a single live surface instead of fragmented reporting tools.'}
                        </p>
                      </div>
                      <div className="rounded-[1rem] border border-white/8 bg-gradient-to-r from-sky-400/8 to-emerald-400/6 p-4">
                        <div className="text-xs uppercase tracking-[0.24em] text-[var(--grey-text-dark)]">System signal</div>
                        <div className="mt-2 text-sm font-medium text-white">
                          {index === 0
                            ? 'Trusted uploads entering ingestion queue'
                            : index === 1
                              ? 'Priority orchestration holding sub-second classification throughput'
                              : 'Live dashboards exposing SLA pressure and hotspot movement'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section id="security" className="relative z-10 mx-auto max-w-7xl px-6 py-16 md:px-8">
        <div className="overflow-hidden rounded-[1.7rem] border border-white/8 bg-[#060b14] shadow-[0_18px_56px_rgba(0,0,0,0.22)]">
          <div className="grid gap-10 px-6 py-10 md:px-10 md:py-12 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">Security and trust</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white md:text-5xl">
                Military-grade infrastructure.
              </h2>
              <p className="mt-5 text-base leading-7 text-slate-300">
                ResolveX is designed for government and enterprise procurement environments where uptime, sovereignty, and auditability are non-negotiable.
              </p>
              <div className="mt-8 rounded-[1.2rem] border border-emerald-400/10 bg-emerald-400/[0.05] p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-emerald-100/60">Operational assurance</div>
                <p className="mt-3 text-sm leading-6 text-emerald-50">
                  High-throughput buffering, role-constrained dashboards, and deploy-anywhere infrastructure create a locked-down surface area for city operations.
                </p>
              </div>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {securityCards.map((card) => (
                <article key={card.title} className="rounded-[1.2rem] border border-white/8 bg-white/[0.025] p-5">
                  <div className="mb-5 h-11 w-11 rounded-2xl border border-white/10 bg-white/[0.06]" />
                  <h3 className="text-xl font-semibold text-white">{card.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-300">{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-6 py-16 md:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-sky-200/80">Live preview</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white md:text-5xl">
              Total command. Zero blind spots.
            </h2>
          </div>
          <Link
            href="/auth/staff?next=/admin/dashboard"
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-white transition hover:border-white/18 hover:bg-white/[0.06]"
          >
            Explore Admin Features
          </Link>
        </div>

        <div className="mt-10 overflow-hidden rounded-[1.7rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] p-3 shadow-[0_18px_54px_rgba(0,0,0,0.24)]">
          <div className="grid gap-4 rounded-[1.35rem] border border-white/8 bg-[#07101c] p-4 lg:grid-cols-[0.3fr_0.7fr]">
            <aside className="rounded-[1.1rem] border border-white/8 bg-white/[0.025] p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-[var(--grey-text-dark)]">Admin stack</div>
              <div className="mt-4 space-y-3">
                {['Live SLA dashboard', 'Heatmap overlays', 'Early warning toasts', 'Priority queue health'].map((item) => (
                  <div key={item} className="rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3 text-sm text-white/90">
                    {item}
                  </div>
                ))}
              </div>
            </aside>
            <div className="grid gap-4 lg:grid-cols-[1fr_0.86fr]">
              <div className="rounded-[1.1rem] border border-white/8 bg-white/[0.025] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-[var(--grey-text-dark)]">SLA countdowns</div>
                    <div className="mt-2 text-2xl font-semibold text-white">Critical tasks by department</div>
                  </div>
                  <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
                    27 active
                  </div>
                </div>
                <div className="mt-6 space-y-4">
                  {[
                    ['Drainage overflow', 82, '1h 18m'],
                    ['Road collapse', 63, '3h 04m'],
                    ['Streetlight outage', 41, '5h 26m'],
                  ].map(([title, width, eta]) => (
                    <div key={title as string}>
                      <div className="mb-2 flex justify-between text-sm text-[var(--grey-text-light)]">
                        <span>{title}</span>
                        <span>{eta}</span>
                      </div>
                      <div className="h-3 rounded-full bg-white/8">
                        <div className="h-3 rounded-full bg-gradient-to-r from-amber-300 via-sky-400 to-emerald-400" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-4">
                <div className="rounded-[1.1rem] border border-white/8 bg-white/[0.025] p-5">
                  <div className="text-xs uppercase tracking-[0.24em] text-[var(--grey-text-dark)]">Live heatmap</div>
                  <div className="mt-4 h-44 rounded-[1rem] border border-white/8 bg-[radial-gradient(circle_at_20%_24%,rgba(244,114,182,0.18),transparent_20%),radial-gradient(circle_at_52%_52%,rgba(56,189,248,0.2),transparent_24%),radial-gradient(circle_at_76%_36%,rgba(250,204,21,0.16),transparent_18%),#0a1524]" />
                </div>
                <div className="rounded-[1.1rem] border border-amber-300/8 bg-amber-300/[0.04] p-5">
                  <div className="text-xs uppercase tracking-[0.24em] text-amber-100/70">Early Warning</div>
                  <p className="mt-3 text-sm leading-6 text-amber-50">
                    Density spike across three adjacent wards suggests a pre-monsoon drainage cluster requiring commissioner attention.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-6 py-16 md:px-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-emerald-200/80">
            Built By The Team
          </p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white md:text-5xl">
            The people shaping ResolveX from product vision to civic AI.
          </h2>
          <p className="mt-5 text-base leading-7 text-[var(--grey-text-light)]">
            Meet the core contributors behind the platform across full stack engineering,
            backend systems, database design, product delivery, and AI intelligence.
          </p>
        </div>

        <div className="mt-12">
          <AnimatedTestimonials autoplay />
        </div>
      </section>

      <section id="integrations" className="relative z-10 overflow-hidden py-16">
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.26em] text-[var(--grey-text-dark)]">
            Built on the same open-source stack driving resilient modern platforms
          </p>
        </div>
        <div className="mt-8 whitespace-nowrap">
          <div className="landing-marquee inline-flex min-w-full items-center gap-4 px-4">
            {[...integrations, ...integrations].map((item, index) => (
              <div key={`${item}-${index}`} className="rounded-full border border-white/10 bg-white/[0.05] px-5 py-3 text-sm font-medium text-white/90 backdrop-blur-md">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="relative z-10 mt-10 border-t border-white/8 bg-[#05080f]">
        <div className="mx-auto max-w-7xl px-6 py-10 md:px-8">
          <div className="flex flex-col gap-4 rounded-[1.35rem] border border-white/8 bg-white/[0.025] px-6 py-6 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-[var(--grey-text-light)]">Ready to modernize your municipality? Deploy ResolveX in 24 hours.</p>
            <Link
              href="/auth/staff?next=/admin/dashboard"
              className="inline-flex items-center justify-center rounded-full bg-[var(--signal-blue)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#4d8cff]"
            >
              Request Production Access
            </Link>
          </div>

          <div className="mt-10 grid gap-8 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <div className="flex items-center gap-3">
                <Image src="/logo.png" alt="ResolveX" width={38} height={38} className="h-9 w-9 object-contain" />
                <span className="text-lg font-semibold text-white">ResolveX</span>
              </div>
              <p className="mt-4 max-w-sm text-sm leading-7 text-[var(--grey-text-light)]">
                Building smarter, safer, and highly responsive cities through artificial intelligence.
              </p>
              <div className="mt-4 text-sm leading-7 text-[var(--grey-text-light)]">
                <div>hello@resolvex.in</div>
                <div>Support Line: +91 9733017660</div>
      
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-white/80">Platform Layer</h3>
              <div className="mt-4 space-y-3 text-sm text-[var(--grey-text-light)]">
                {portalCards.map((card) => (
                  <Link key={card.title} href={card.href} className="block transition hover:text-white">
                    {card.title}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-white/80">Security and Trust</h3>
              <div className="mt-4 space-y-3 text-sm text-[var(--grey-text-light)]">
                <a href="#security" className="block transition hover:text-white">Trust Center</a>
                <span className="block">Privacy Policy (GDPR / DPDP Act Compliant)</span>
                <span className="block">Service Level Agreements (SLA)</span>
                <span className="inline-flex rounded-full border border-emerald-400/18 bg-emerald-400/8 px-3 py-1 text-emerald-200">
                  All Systems Operational
                </span>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-white/80">Connect</h3>
              <div className="mt-4 space-y-3 text-sm text-[var(--grey-text-light)]">
                <a href="https://github.com" target="_blank" rel="noreferrer" className="block transition hover:text-white">GitHub Repository</a>
                <a href="https://nextjs.org/docs" target="_blank" rel="noreferrer" className="block transition hover:text-white">Developer Documentation</a>
                <span className="block">Case Studies</span>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-4 border-t border-white/8 pt-6 text-sm text-[var(--grey-text-dark)] md:flex-row md:items-center md:justify-between">
            <span>© 2026 ResolveX Technologies. All rights reserved.</span>
            <div className="flex gap-5">
              <a href="https://www.linkedin.com" target="_blank" rel="noreferrer" className="transition hover:text-white">LinkedIn</a>
              <a href="https://x.com" target="_blank" rel="noreferrer" className="transition hover:text-white">X</a>
              <a href="https://github.com" target="_blank" rel="noreferrer" className="transition hover:text-white">GitHub</a>
            </div>
          </div>

          {DEMO_MODE && (
            <div className="mt-8 max-w-md">
              <button
                onClick={handleDemoLogin}
                disabled={loading}
                className="inline-flex w-full items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3.5 text-sm font-semibold text-white transition hover:border-white/18 hover:bg-white/[0.06] disabled:opacity-60"
              >
                {loading ? 'Starting demo session...' : 'Try as Demo Citizen'}
              </button>
              {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
            </div>
          )}
        </div>
      </footer>
    </main>
  );
}