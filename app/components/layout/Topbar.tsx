'use client';

import { useAuth } from '@/app/hooks/useAuth';
import { useTheme } from '@/app/hooks/useTheme';
import { useRouter, usePathname } from 'next/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  RiSunLine,
  RiMoonLine,
  RiLogoutBoxLine,
  RiLockPasswordLine,
  RiAdminLine,
} from '@remixicon/react';

const NAV_ITEMS = [
  { id: 'home', label: 'Home', path: '/' },
  { id: 'agents', label: 'Agents', path: '/agents' },
  { id: 'usage', label: 'Usage', path: '/usage' },
  { id: 'skills', label: 'Skills', path: '/skills' },
  { id: 'chat', label: 'Chat', path: '/chat' },
  { id: 'boards', label: 'Boards', path: '/boards' },
  { id: 'logs', label: 'Logs', path: '/logs' },
  { id: 'mon', label: 'Monitor', path: '/mon' },
  { id: 'maintenance', label: 'Maintenance', path: '/maintenance' },
  { id: 'files', label: 'Files', path: '/files' },
];

export default function Topbar() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();

  const getPageFromPath = (path: string) => {
    if (path === '/') return 'home';
    return path.split('/')[1];
  };

  const currentPage = getPageFromPath(pathname);

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const initials = (user?.username || 'U').charAt(0).toUpperCase();

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/50 px-3">
      {/* Logo */}
      <div className="flex shrink-0 items-center gap-2">
        <img src="/logo.png" alt="Hermes" className="size-6" />
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Hermes Dashboard
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 items-center justify-center gap-0.5 overflow-hidden">
        {NAV_ITEMS.map((item) => {
          const isActive = getPageFromPath(pathname) === item.id;
          return (
            <Button
              key={item.id}
              variant={isActive ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => router.push(item.path)}
            >
              {item.label}
            </Button>
          );
        })}
      </nav>

      {/* Right actions */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Theme toggle */}
        <Button variant="ghost" size="icon-sm" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? <RiSunLine /> : <RiMoonLine />}
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'gap-2')}
          >
            <Avatar className="size-5">
              <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
            </Avatar>
            <span className="hidden sm:inline">{user?.username || 'user'}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              {user?.role === 'admin' && (
                <DropdownMenuItem onClick={() => router.push('/users')}>
                  <RiAdminLine />
                  <span>User Management</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => router.push('/change-password')}>
                <RiLockPasswordLine />
                <span>Change Password</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <RiLogoutBoxLine />
              <span>Logout</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
