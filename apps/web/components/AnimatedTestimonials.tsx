'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { SVGProps } from 'react';

type SocialPlatform = 'twitter' | 'linkedin' | 'instagram' | 'github';

type Testimonial = {
  name: string;
  designation: string;
  quote: string;
  src: string;
  socials: Array<{
    platform: SocialPlatform;
    url: string;
  }>;
};

const socialIconMap = {
  twitter: TwitterIcon,
  linkedin: LinkedinIcon,
  instagram: InstagramIcon,
  github: GithubIcon,
} as const;

const testimonials: Testimonial[] = [
  {
    name: 'Danish Shah',
    designation: 'Full Stack, DBMS Developer',
    quote: 'Third Year IT Student at Techno Main Salt Lake and a core builder behind ResolveX.',
    src: '/ME.jpeg',
    socials: [
      { platform: 'instagram', url: 'https://www.instagram.com/danish_shanil?igsh=M3hmMjNzZHcxOGtq' },
      { platform: 'linkedin', url: 'https://www.linkedin.com/in/danish-shah-65454021b' },
      { platform: 'github', url: 'https://github.com/DanishShah619' },
    ],
  },
  {
    name: 'Arnab Maiti',
    designation: 'Backend, Blockchain',
    quote: 'Third Year IT Student at Techno Main Salt Lake building blockchain-powered solutions for trust, automation, and real-world impact.',
    src: '/Arnab.jpeg',
    socials: [
      { platform: 'linkedin', url: 'https://www.linkedin.com/in/arnab-maiti-b1151527b' },
      { platform: 'github', url: 'https://github.com/arnab-maiti' },
    ],
  },
  {
    name: 'Abdul Rahman',
    designation: 'AI Expert',
    quote: 'Third Year IT Student at Techno Main Salt Lake driving the intelligence layer behind automated civic issue classification.',
    src: '/Abdul.jpeg',
    socials: [
      { platform: 'instagram', url: 'https://www.instagram.com/epsilonstar02/profilecard/?igsh=MTdzNHBoMjU4eHNlMg==' },
      { platform: 'linkedin', url: 'https://www.linkedin.com/in/abdul-rahman58322' },
      { platform: 'github', url: 'https://github.com/epsilonstar-02' },
    ],
  },
  {
    name: 'Ankit Kumar Jha',
    designation: 'AI Expert, Product Resource Manager',
    quote: 'Third Year IT Student at Techno Main Salt Lake shaping product direction and AI delivery for the platform.',
    src: '/Ankit.jpeg',
    socials: [
      { platform: 'instagram', url: 'https://www.instagram.com/virtual_shootout?igsh=eGcxdnEyOW13MTBx' },
      { platform: 'linkedin', url: 'https://www.linkedin.com/in/ankit-kumar-jha-140b32287' },
      { platform: 'github', url: 'https://github.com/Ankitj9568' },
    ],
  },
];

const getTilt = (index: number) => (index % 2 === 0 ? -6 : 6);

export default function AnimatedTestimonials({
  autoplay = true,
}: {
  autoplay?: boolean;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!autoplay || testimonials.length <= 1) return;

    const interval = window.setInterval(() => {
      setActive((prev) => (prev + 1) % testimonials.length);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [autoplay]);

  const handleNext = () => {
    setActive((prev) => (prev + 1) % testimonials.length);
  };

  const handlePrev = () => {
    setActive((prev) => (prev - 1 + testimonials.length) % testimonials.length);
  };

  const current = testimonials[active];

  return (
    <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
      <div className="relative min-h-[25rem]">
        <div className="absolute inset-x-[8%] top-[10%] h-[72%] rounded-full bg-[var(--signal-blue)]/12 blur-[110px]" />
        <div className="absolute inset-x-[16%] bottom-[2%] h-[30%] rounded-full bg-emerald-400/10 blur-[90px]" />
        <div className="relative mx-auto h-[25rem] max-w-md">
          <AnimatePresence mode="popLayout">
            {testimonials.map((testimonial, index) => {
              const isActive = index === active;

              return (
                <motion.div
                  key={`${testimonial.name}-${testimonial.src}`}
                  initial={{
                    opacity: 0,
                    scale: 0.92,
                    rotate: getTilt(index),
                    y: 30,
                  }}
                  animate={{
                    opacity: isActive ? 1 : 0.42,
                    scale: isActive ? 1 : 0.94,
                    rotate: isActive ? 0 : getTilt(index),
                    y: isActive ? 0 : index < active ? -12 : 12,
                    zIndex: isActive ? 30 : testimonials.length - index,
                  }}
                  exit={{
                    opacity: 0,
                    scale: 0.94,
                    rotate: -getTilt(index),
                    y: -24,
                  }}
                  transition={{ duration: 0.45, ease: 'easeInOut' }}
                  className="absolute inset-0 origin-bottom"
                >
                  <div className="h-full overflow-hidden rounded-[2rem] border border-white/10 bg-[var(--secondary-dark)] p-3 shadow-[0_28px_60px_rgba(0,0,0,0.34)] backdrop-blur-sm">
                    <img
                      src={testimonial.src}
                      alt={testimonial.name}
                      draggable={false}
                      className="h-full w-full rounded-[1.5rem] object-cover object-center"
                    />
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <div className="rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] p-7 shadow-[0_18px_54px_rgba(0,0,0,0.24)] backdrop-blur-sm md:p-9">
        <motion.div
          key={current.name}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
        >
          <div className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/8 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100/80">
            Team Voices
          </div>
          <h3 className="mt-6 text-3xl font-semibold tracking-[-0.04em] text-white md:text-4xl">
            {current.name}
          </h3>
          <p className="mt-2 text-sm font-medium uppercase tracking-[0.22em] text-[var(--grey-text-dark)]">
            {current.designation}
          </p>

          <motion.p className="mt-6 text-lg leading-8 text-[var(--grey-text-light)]">
            {current.quote.split(' ').map((word, index) => (
              <motion.span
                key={`${current.name}-${word}-${index}`}
                initial={{ filter: 'blur(10px)', opacity: 0, y: 6 }}
                animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
                transition={{
                  duration: 0.22,
                  ease: 'easeOut',
                  delay: index * 0.025,
                }}
                className="inline-block"
              >
                {word}&nbsp;
              </motion.span>
            ))}
          </motion.p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {current.socials.map((link) => {
              const Icon = socialIconMap[link.platform];
              return (
                <a
                  key={`${current.name}-${link.platform}`}
                  href={link.url.trim()}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition duration-300 hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
                  aria-label={`${current.name} on ${link.platform}`}
                >
                  <Icon className="h-5 w-5" />
                </a>
              );
            })}
          </div>
        </motion.div>

        <div className="mt-10 flex items-center justify-between gap-4 border-t border-white/8 pt-6">
          <div className="text-sm text-[var(--grey-text-dark)]">
            {String(active + 1).padStart(2, '0')} / {String(testimonials.length).padStart(2, '0')}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handlePrev}
              className="group flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] transition duration-300 hover:border-white/18 hover:bg-white/[0.08]"
              aria-label="Previous testimonial"
            >
              <ArrowLeft className="h-5 w-5 text-white/80 transition duration-300 group-hover:-translate-x-0.5" />
            </button>
            <button
              onClick={handleNext}
              className="group flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] transition duration-300 hover:border-white/18 hover:bg-white/[0.08]"
              aria-label="Next testimonial"
            >
              <ArrowRight className="h-5 w-5 text-white/80 transition duration-300 group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TwitterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18.9 2H22l-6.77 7.73L23.2 22h-6.25l-4.9-7.42L5.55 22H2.44l7.24-8.27L1.8 2h6.4l4.43 6.72L18.9 2Zm-1.1 18h1.73L7.2 3.9H5.34L17.8 20Z" />
    </svg>
  );
}

function LinkedinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M6.94 8.5H3.56V20h3.38V8.5ZM5.25 3A1.96 1.96 0 1 0 5.3 6.9 1.96 1.96 0 0 0 5.25 3ZM20.44 13.06c0-3.34-1.78-4.9-4.16-4.9-1.92 0-2.77 1.05-3.24 1.79V8.5H9.66c.05.96 0 11.5 0 11.5h3.38v-6.42c0-.34.02-.68.13-.92.27-.68.88-1.39 1.9-1.39 1.34 0 1.88 1.03 1.88 2.54V20h3.38v-6.94Z" />
    </svg>
  );
}

function InstagramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2Zm0 1.75A4 4 0 0 0 3.75 7.75v8.5a4 4 0 0 0 4 4h8.5a4 4 0 0 0 4-4v-8.5a4 4 0 0 0-4-4h-8.5Zm8.75 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.75A3.25 3.25 0 1 0 12 15.25 3.25 3.25 0 0 0 12 8.75Z" />
    </svg>
  );
}

function GithubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .5a12 12 0 0 0-3.8 23.39c.6.12.82-.26.82-.58l-.02-2.04c-3.34.73-4.04-1.42-4.04-1.42-.55-1.38-1.33-1.75-1.33-1.75-1.08-.75.08-.74.08-.74 1.2.08 1.84 1.24 1.84 1.24 1.06 1.83 2.8 1.3 3.48 1 .11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.53.12-3.2 0 0 1.02-.33 3.34 1.23a11.5 11.5 0 0 1 6.08 0c2.32-1.56 3.34-1.22 3.34-1.22.66 1.66.24 2.9.12 3.2.77.84 1.24 1.9 1.24 3.21 0 4.61-2.8 5.63-5.48 5.93.43.38.82 1.1.82 2.22l-.02 3.3c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}