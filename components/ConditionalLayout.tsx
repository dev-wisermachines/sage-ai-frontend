'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';

export function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === '/login';

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Slim top bar */}
      <div className="h-8 bg-dark-panel border-b border-dark-border flex items-center justify-center">
        <span className="heading-inter text-sm text-white">sage</span>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

