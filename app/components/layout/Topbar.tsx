'use client';

import { useAuth } from '@/app/hooks/useAuth';
import { useTheme } from '@/app/hooks/useTheme';
import { useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { id: 'home', label: 'Home', path: '/' },
  { id: 'agents', label: 'Agents', path: '/agents' },
  { id: 'usage', label: 'Usage', path: '/usage' },
  { id: 'skills', label: 'Skills', path: '/skills' },
  { id: 'chat', label: 'Chat', path: '/chat' },
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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentPage = pathname === '/' ? 'home' : pathname.split('/')[1];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNavClick = (path: string) => {
    router.push(path);
  };

  const handleLogout = async () => {
    setUserMenuOpen(false);
    await logout();
    router.push('/login');
  };

  const getPageFromPath = (path: string) => {
    if (path === '/') return 'home';
    return path.split('/')[1];
  };

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      height: '48px',
      padding: '0 12px',
      background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border)',
      gap: '8px',
      flexShrink: 0,
      zIndex: 100,
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <img src="/hermes-icon.svg" alt="Hermes" style={{ height: '24px', width: '24px' }} />
        <span style={{ color: 'var(--fg-muted)', fontSize: '12px', whiteSpace: 'nowrap' }}>
          Hermes Control Interface
        </span>
      </div>

      <nav style={{ display: 'flex', gap: '2px', flex: 1, justifyContent: 'center', overflow: 'hidden' }}>
        {NAV_ITEMS.map((item) => {
          const isActive = getPageFromPath(pathname) === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.path)}
              style={{
                background: isActive ? 'var(--accent-dim)' : 'transparent',
                color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
                border: 'none',
                borderRadius: 'var(--radius)',
                padding: '4px 12px',
                fontFamily: 'var(--font)',
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all var(--transition)',
                whiteSpace: 'nowrap',
              }}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        <button
          onClick={toggleTheme}
          className="icon-btn"
          title="Toggle theme"
          style={{ fontSize: '14px', padding: '4px 8px' }}
        >
          {theme === 'dark' ? '🌙' : '☀️'}
        </button>

        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="icon-btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              padding: '4px 10px',
            }}
          >
            <span>{user?.username || 'user'}</span>
            <span style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>{user?.role}</span>
          </button>

          {userMenuOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow)',
              minWidth: '180px',
              zIndex: 200,
            }}>
              {user?.role === 'admin' && (
                <button
                  onClick={() => { setUserMenuOpen(false); router.push('/users'); }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--fg)',
                    fontFamily: 'var(--font)',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  👥 User Management
                </button>
              )}
              <button
                onClick={() => { setUserMenuOpen(false); router.push('/change-password'); }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--fg)',
                  fontFamily: 'var(--font)',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Change Password
              </button>
              <button
                onClick={handleLogout}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  background: 'none',
                  border: 'none',
                  borderTop: '1px solid var(--border)',
                  color: 'var(--red)',
                  fontFamily: 'var(--font)',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
