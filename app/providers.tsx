'use client';

import { type ReactNode } from 'react';
import { AuthProvider } from '@/app/hooks/useAuth';
import { ThemeProvider } from '@/app/hooks/useTheme';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        {children}
      </AuthProvider>
    </ThemeProvider>
  );
}
