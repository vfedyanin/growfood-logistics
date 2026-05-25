'use client';

import { useSession } from 'next-auth/react';

export function usePermissions() {
  const { data } = useSession();
  const roles: string[] = (data?.user as any)?.roles ?? [];
  const permissions: string[] = (data?.user as any)?.permissions ?? [];
  const isAdmin = roles.includes('ADMIN');
  const can = (perm: string) => isAdmin || permissions.includes(perm);
  const hasRole = (...r: string[]) => isAdmin || r.some((x) => roles.includes(x));
  return { roles, permissions, isAdmin, can, hasRole };
}
