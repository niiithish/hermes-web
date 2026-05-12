'use client';

import Topbar from '@/app/components/layout/Topbar';

export default function BoardsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <Topbar />
      <main className="flex-1 overflow-hidden relative">
        {children}
      </main>
    </div>
  );
}
