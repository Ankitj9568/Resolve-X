'use client';
// apps/web/components/RoleRouter.tsx
// Redirects to the correct landing page based on role.
// Uses App Router — next/navigation not next/router.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  role: string;
}

const ROLE_LANDING: Record<string, string> = {
  citizen:      '/citizen/home',
  officer:      '/officer/tasks',
  dept_head:    '/admin/dashboard',
  commissioner: '/admin/command',
};

export default function RoleRouter({ role }: Props) {
  const router = useRouter();

  useEffect(() => {
    const path = ROLE_LANDING[role];
    if (path) router.push(path);
  }, [role, router]);

  return null;
}