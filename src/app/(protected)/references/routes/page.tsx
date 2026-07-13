'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RoutesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/references/directions'); }, [router]);
  return null;
}
