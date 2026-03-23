'use client';
// apps/web/components/IssueAnalysisCard.tsx

import { useEffect, useState } from 'react';

const DETECTION_TABLE: Record<string, Array<{ label: string; confidence: number; dept: string }>> = {
  'CAT-01': [{ label: 'Waste accumulation nearby', confidence: 0.71, dept: 'Sanitation' }, { label: 'Waterlogging risk', confidence: 0.58, dept: 'Drainage' }],
  'CAT-02': [{ label: 'Flooding risk', confidence: 0.74, dept: 'Drainage' }, { label: 'Foul odour / sanitation hazard', confidence: 0.63, dept: 'Sanitation' }],
  'CAT-03': [{ label: 'Safety and crime risk', confidence: 0.69, dept: 'Electrical' }, { label: 'Electrical infrastructure age', confidence: 0.52, dept: 'Electrical' }],
  'CAT-04': [{ label: 'Health hazard', confidence: 0.81, dept: 'Sanitation' }, { label: 'Groundwater contamination risk', confidence: 0.55, dept: 'Water' }],
  'CAT-05': [{ label: 'Pipeline burst prediction', confidence: 0.77, dept: 'Water' }, { label: 'Road damage risk', confidence: 0.49, dept: 'Roads' }],
  'CAT-06': [{ label: 'Accessibility barrier', confidence: 0.72, dept: 'Parks' }, { label: 'Rainwater pooling risk', confidence: 0.61, dept: 'Drainage' }],
  'CAT-07': [{ label: 'Traffic flow disruption', confidence: 0.66, dept: 'Roads' }, { label: 'Pedestrian safety risk', confidence: 0.58, dept: 'Roads' }],
  'CAT-08': [{ label: 'Public health hazard', confidence: 0.60, dept: 'Sanitation' }, { label: 'Regulatory violation', confidence: 0.55, dept: 'General' }],
  'CAT-09': [{ label: 'Public safety risk', confidence: 0.73, dept: 'General' }, { label: 'Road accident potential', confidence: 0.61, dept: 'Roads' }],
  'CAT-10': [],
};

const CATEGORY_LABELS: Record<string, string> = {
  'CAT-01': 'Roads / Pothole',   'CAT-02': 'Drainage / Blocked',
  'CAT-03': 'Streetlight / Out', 'CAT-04': 'Waste / Garbage',
  'CAT-05': 'Water / Leakage',   'CAT-06': 'Parks / Damaged',
  'CAT-07': 'Encroachment',      'CAT-08': 'Noise / Pollution',
  'CAT-09': 'Stray Animals',     'CAT-10': 'Other',
};

interface Props {
  category: string;
}

export default function IssueAnalysisCard({ category }: Props) {
  const [visible, setVisible] = useState(false);
  const secondaries = DETECTION_TABLE[category] ?? [];

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(t);
  }, [category]);

  if (!category) return null;

  const totalDepts = 1 + new Set(secondaries.map(s => s.dept)).size;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden text-sm">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          AI Detected Issues
        </span>
      </div>

      <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100">
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-medium text-indigo-900">{CATEGORY_LABELS[category]}</span>
          <span className="text-xs text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">Primary</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-indigo-100 rounded-full">
            <div className="h-full bg-indigo-500 rounded-full w-full" />
          </div>
          <span className="text-xs text-indigo-600 w-8 text-right">100%</span>
        </div>
      </div>

      {secondaries.map((issue, i) => (
        <div
          key={issue.label}
          className="px-4 py-3 border-b border-amber-100 bg-amber-50"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(8px)',
            transition: `opacity 300ms ${i * 150}ms, transform 300ms ${i * 150}ms`,
          }}
        >
          <p className="font-medium text-amber-900">{issue.label}</p>
          <p className="text-xs text-amber-600 mb-1.5">AI Detected · Also routed to {issue.dept}</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-amber-100 rounded-full">
              <div className="h-full bg-amber-400 rounded-full" style={{ width: `${issue.confidence * 100}%` }} />
            </div>
            <span className="text-xs text-amber-600 w-8 text-right">{Math.round(issue.confidence * 100)}%</span>
          </div>
        </div>
      ))}

      <div className="px-4 py-2.5 bg-gray-50 text-xs text-gray-500">
        <span className="font-medium text-gray-700">{totalDepts} department{totalDepts !== 1 ? 's' : ''} notified</span>
        {' · '}1 complaint filed · SLA timers started
      </div>
    </div>
  );
}