'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/lib/api-client';

// ─── Permission Constants ────────────────────────────────────────────

const ALL_PERMISSIONS = [
  'chat.use', 'chat.configure', 'chat.clear',
  'agents.manage', 'agents.configure',
  'skills.manage',
  'logs.view',
  'maintenance.use',
  'files.read', 'files.write',
  'admin.access', 'admin.users',
  'api.access',
  'terminal.use', 'terminal.configure',
  'system.manage',
  'gateway.manage',
  'cron.manage',
  'usage.view', 'usage.detailed',
  'mon.view',
  'settings.read', 'settings.write',
] as const;

type Permission = (typeof ALL_PERMISSIONS)[number];

const PERMISSION_CATEGORIES: { label: string; perms: Permission[] }[] = [
  { label: 'Chat', perms: ['chat.use', 'chat.configure', 'chat.clear'] },
  { label: 'Agents', perms: ['agents.manage', 'agents.configure'] },
  { label: 'Skills', perms: ['skills.manage'] },
  { label: 'Logs', perms: ['logs.view'] },
  { label: 'Maintenance', perms: ['maintenance.use'] },
  { label: 'Files', perms: ['files.read', 'files.write'] },
  { label: 'Admin', perms: ['admin.access', 'admin.users'] },
  { label: 'API', perms: ['api.access'] },
  { label: 'Terminal', perms: ['terminal.use', 'terminal.configure'] },
  { label: 'System', perms: ['system.manage'] },
  { label: 'Gateway', perms: ['gateway.manage'] },
  { label: 'Cron', perms: ['cron.manage'] },
  { label: 'Usage', perms: ['usage.view', 'usage.detailed'] },
  { label: 'Monitor', perms: ['mon.view'] },
  { label: 'Settings', perms: ['settings.read', 'settings.write'] },
];

const ROLE_PRESETS: Record<string, Partial<Record<Permission, boolean>>> = {
  admin: Object.fromEntries(ALL_PERMISSIONS.map((p) => [p, true])) as Record<Permission, boolean>,
  viewer: {
    'chat.use': true,
    'logs.view': true,
    'files.read': true,
    'usage.view': true,
    'mon.view': true,
    'settings.read': true,
  },
  custom: {},
};

// ─── Types ───────────────────────────────────────────────────────────

interface User {
  username: string;
  role: string;
  permissions?: Record<string, boolean>;
  last_login: string | null;
  created_at: string;
}

interface AuditEntry {
  timestamp: string;
  username: string;
  role: string;
  action: string;
  details: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function parseAuditLine(line: string): AuditEntry | null {
  const match = line.match(
    /^\[([^\]]+)\] \[([^\]]+)\] \[([^\]]+)\] (\S+):\s*(.*)$/,
  );
  if (!match) return null;
  return {
    timestamp: match[1],
    username: match[2],
    role: match[3],
    action: match[4],
    details: match[5] || '',
  };
}

function auditActionColor(action: string): string {
  switch (action) {
    case 'LOGIN':
    case 'SETUP':
      return 'var(--green)';
    case 'LOGIN_FAILED':
    case 'DENIED':
    case 'SESSION_DELETE':
    case 'USER_DELETE':
    case 'PROFILE_DELETE':
    case 'KEY_DELETE':
    case 'LOGOUT':
      return 'var(--red)';
    case 'USER_CREATE':
    case 'RESET_PASSWORD':
    case 'CHANGE_PASSWORD':
    case 'PROFILE_CREATE':
    case 'BACKUP_CREATE':
      return 'var(--blue)';
    case 'CONFIG_UPDATE':
    case 'KEY_REVEAL':
    case 'KEY_UPDATE':
    case 'HERMES_UPDATE':
    case 'HCI_RESTART':
    case 'BACKUP_IMPORT':
      return 'var(--amber)';
    default:
      return 'var(--fg-muted)';
  }
}

function roleBadgeStyle(role: string): React.CSSProperties {
  return {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '4px',
    background: role === 'admin' ? 'var(--accent-dim)' : 'var(--bg-panel-hover)',
    color: role === 'admin' ? 'var(--accent)' : 'var(--fg-muted)',
    border: '1px solid var(--border)',
    textTransform: 'uppercase' as const,
    fontWeight: 500,
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDateShort(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function countPermissions(permissions?: Record<string, boolean>): number {
  if (!permissions) return 0;
  return Object.values(permissions).filter(Boolean).length;
}

// ─── Styles ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STYLES: Record<string, any> = {
  container: {
    display: 'flex',
    height: '100%',
    overflow: 'hidden',
  },
  leftPanel: {
    flex: '1 1 60%',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px',
    overflowY: 'auto',
    borderRight: '1px solid var(--border)',
  },
  rightPanel: {
    flex: '1 1 40%',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 600,
    margin: 0,
  },
  subtitle: {
    color: 'var(--fg-muted)',
    marginBottom: '16px',
    fontSize: '13px',
  },
  table: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flex: 1,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--bg-panel)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '10px 14px',
    gap: '12px',
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
  },
  username: {
    fontWeight: 500,
    fontSize: '13px',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  meta: {
    fontSize: '11px',
    color: 'var(--fg-muted)',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
  },
  iconBtn: (danger?: boolean): React.CSSProperties => ({
    background: 'var(--bg-panel-hover)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: danger ? 'var(--red)' : 'var(--fg)',
    cursor: 'pointer',
    padding: '4px 10px',
    fontSize: '14px',
    lineHeight: 1,
    fontFamily: 'var(--font)',
    transition: 'all var(--transition)',
  }),
  modalOverlay: {
    position: 'fixed' as const,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.6)',
    zIndex: 999,
  },
  modalCard: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '24px',
    minWidth: '420px',
    maxWidth: '90vw',
    maxHeight: '85vh',
    overflowY: 'auto' as const,
    boxShadow: 'var(--shadow)',
  },
  modalTitle: {
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '16px',
    color: 'var(--fg-base)',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    marginBottom: '12px',
  },
  label: {
    fontSize: '12px',
    color: 'var(--fg-muted)',
    fontWeight: 500,
  },
  input: {
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--fg)',
    fontFamily: 'var(--font)',
    fontSize: '13px',
    padding: '8px 12px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  passwordRow: {
    display: 'flex',
    gap: '4px',
  },
  toggleBtn: {
    background: 'var(--bg-panel-hover)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--fg-muted)',
    cursor: 'pointer',
    padding: '6px 10px',
    fontSize: '12px',
    fontFamily: 'var(--font)',
    flexShrink: 0,
  },
  roleBtns: {
    display: 'flex',
    gap: '6px',
  },
  roleBtn: (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--accent-dim)' : 'var(--bg-panel)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 'var(--radius)',
    color: active ? 'var(--accent)' : 'var(--fg-muted)',
    cursor: 'pointer',
    padding: '6px 14px',
    fontSize: '13px',
    fontFamily: 'var(--font)',
    fontWeight: active ? 600 : 400,
    transition: 'all var(--transition)',
  }),
  permCategory: {
    marginBottom: '12px',
  },
  permCatLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--fg-muted)',
    marginBottom: '4px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  permGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: 'var(--fg)',
    padding: '3px 6px',
    borderRadius: '4px',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  checkbox: {
    accentColor: 'var(--accent)',
    cursor: 'pointer',
    margin: 0,
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '16px',
  },
  btn: (variant: 'primary' | 'ghost' | 'danger', small?: boolean): React.CSSProperties => {
    let bg = 'var(--bg-panel)';
    let color = 'var(--fg)';
    let border = '1px solid var(--border)';
    if (variant === 'primary') {
      bg = 'var(--accent)';
      color = '#fff';
      border = 'none';
    } else if (variant === 'danger') {
      bg = 'rgba(196, 92, 92, 0.15)';
      color = 'var(--red)';
      border = '1px solid var(--red)';
    }
    return {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      padding: small ? '4px 10px' : '8px 16px',
      border,
      borderRadius: 'var(--radius)',
      background: bg,
      color,
      fontFamily: 'var(--font)',
      fontSize: small ? '12px' : '13px',
      fontWeight: 500,
      cursor: 'pointer',
      transition: 'all var(--transition)',
      whiteSpace: 'nowrap' as const,
      opacity: undefined as unknown as number,
    };
  },
  auditEntry: (color: string): React.CSSProperties => ({
    fontSize: '11px',
    padding: '6px 8px',
    marginBottom: '2px',
    borderRadius: '4px',
    background: 'var(--bg-panel)',
    borderLeft: `3px solid ${color}`,
    lineHeight: 1.5,
    wordBreak: 'break-all' as const,
  }),
  auditAction: (color: string): React.CSSProperties => ({
    color,
    fontWeight: 600,
  }),
  auditTime: {
    color: 'var(--fg-subtle)',
    marginRight: '4px',
  },
  toast: (type: 'success' | 'error'): React.CSSProperties => ({
    position: 'fixed' as const,
    top: '60px',
    right: '24px',
    padding: '10px 18px',
    borderRadius: 'var(--radius)',
    background: type === 'success' ? 'rgba(124, 148, 92, 0.2)' : 'rgba(196, 92, 92, 0.2)',
    border: `1px solid ${type === 'success' ? 'var(--green)' : 'var(--red)'}`,
    color: type === 'success' ? 'var(--green)' : 'var(--red)',
    fontSize: '13px',
    zIndex: 2000,
    fontWeight: 500,
  }),
  resetSubSection: {
    marginTop: '12px',
    padding: '12px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    color: 'var(--fg-muted)',
  },
};

// ─── Component ────────────────────────────────────────────────────────

export default function UsersPage() {
  const router = useRouter();

  // Data
  const [users, setUsers] = useState<User[]>([]);
  const [auditEntries, setAuditEntries] = useState<string[]>([]);
  const [auditLimit, setAuditLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(true);
  const [error, setError] = useState('');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createUsername, setCreateUsername] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [createRole, setCreateRole] = useState<'admin' | 'viewer' | 'custom'>('viewer');
  const [createPerms, setCreatePerms] = useState<Record<string, boolean>>({});
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');

  // Edit modal
  const [showEdit, setShowEdit] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editRole, setEditRole] = useState<'admin' | 'viewer' | 'custom'>('viewer');
  const [editPerms, setEditPerms] = useState<Record<string, boolean>>({});
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState('');
  // Password reset
  const [showResetPwd, setShowResetPwd] = useState(false);
  const [resetNewPwd, setResetNewPwd] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState('');

  // Delete modal
  const [showDelete, setShowDelete] = useState(false);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ─── Fetch Users ──────────────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    try {
      const data = await api.getUsers();
      if (data.ok) {
        setUsers(data.users as User[]);
      } else {
        setError((data as unknown as { error?: string }).error || 'Failed to load users');
      }
    } catch (err) {
      if (err instanceof Error && (err as { status?: number }).status === 403) {
        router.push('/');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [router]);

  // ─── Fetch Audit ───────────────────────────────────────────────────

  const fetchAudit = useCallback(async (limit: number) => {
    setAuditLoading(true);
    try {
      const data = await api.get<{ ok: boolean; entries: string[] }>(
        `/api/audit?limit=${limit}`,
      );
      if (data.ok) {
        setAuditEntries(data.entries);
      }
    } catch {
      // silently fail audit log
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const loadMoreAudit = () => {
    const next = auditLimit + 50;
    setAuditLimit(next);
    fetchAudit(next);
  };

  useEffect(() => {
    fetchUsers();
    fetchAudit(auditLimit);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Reset Create Form ──────────────────────────────────────────────

  const openCreateModal = () => {
    setCreateUsername('');
    setCreatePassword('');
    setShowPassword(false);
    setCreateRole('viewer');
    setCreatePerms({ ...ROLE_PRESETS.viewer });
    setCreateError('');
    setShowCreate(true);
  };

  const setCreateRoleWithPreset = (role: 'admin' | 'viewer' | 'custom') => {
    setCreateRole(role);
    if (role !== 'custom') {
      setCreatePerms({ ...ROLE_PRESETS[role] });
    }
  };

  const toggleCreatePerm = (perm: string) => {
    if (createRole !== 'custom') return;
    setCreatePerms((prev) => ({ ...prev, [perm]: !prev[perm] }));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    if (!createUsername.trim()) {
      setCreateError('Username is required');
      return;
    }
    if (createPassword.length < 8) {
      setCreateError('Password must be at least 8 characters');
      return;
    }
    setCreateSubmitting(true);
    try {
      const perms = createRole === 'custom' ? createPerms : undefined;
      const data = await api.createUser(createUsername.trim(), createPassword, createRole, perms);
      if (data.ok) {
        setShowCreate(false);
        showToast(`User "${createUsername.trim()}" created`, 'success');
        await fetchUsers();
        fetchAudit(auditLimit);
      } else {
        setCreateError((data as unknown as { error?: string }).error || 'Failed to create user');
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreateSubmitting(false);
    }
  };

  // ─── Edit ────────────────────────────────────────────────────────────

  const openEditModal = (user: User) => {
    setEditUser(user);
    const role = (['admin', 'viewer', 'custom'].includes(user.role) ? user.role : 'viewer') as 'admin' | 'viewer' | 'custom';
    setEditRole(role);
    setEditPerms(user.permissions ? { ...user.permissions } : { ...ROLE_PRESETS[role] });
    setEditError('');
    setShowResetPwd(false);
    setResetNewPwd('');
    setResetError('');
    setShowEdit(true);
  };

  const setEditRoleWithPreset = (role: 'admin' | 'viewer' | 'custom') => {
    setEditRole(role);
    if (role !== 'custom') {
      setEditPerms({ ...ROLE_PRESETS[role] });
    }
  };

  const toggleEditPerm = (perm: string) => {
    if (editRole !== 'custom') return;
    setEditPerms((prev) => ({ ...prev, [perm]: !prev[perm] }));
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError('');
    if (!editUser) return;
    setEditSubmitting(true);
    try {
      const perms = editRole === 'custom' ? editPerms : undefined;
      const data = await api.updateUser(editUser.username, editRole, perms);
      if (data.ok) {
        setShowEdit(false);
        showToast(`User "${editUser.username}" updated`, 'success');
        await fetchUsers();
        fetchAudit(auditLimit);
      } else {
        setEditError((data as unknown as { error?: string }).error || 'Failed to update user');
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!editUser) return;
    setResetError('');
    if (resetNewPwd.length < 8) {
      setResetError('New password must be at least 8 characters');
      return;
    }
    setResetSubmitting(true);
    try {
      const data = await api.post<{ ok: boolean; error?: string }>(
        `/api/users/${encodeURIComponent(editUser.username)}/reset-password`,
        { new_password: resetNewPwd },
      );
      if (data.ok) {
        showToast(`Password reset for "${editUser.username}"`, 'success');
        setShowResetPwd(false);
        setResetNewPwd('');
      } else {
        setResetError(data.error || 'Failed to reset password');
      }
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setResetSubmitting(false);
    }
  };

  // ─── Delete ──────────────────────────────────────────────────────────

  const openDeleteModal = (user: User) => {
    setDeleteUser(user);
    setShowDelete(true);
  };

  const handleDelete = async () => {
    if (!deleteUser) return;
    setDeleteSubmitting(true);
    try {
      const data = await api.deleteUser(deleteUser.username);
      if (data.ok) {
        setShowDelete(false);
        setDeleteUser(null);
        showToast(`User "${deleteUser.username}" deleted`, 'success');
        await fetchUsers();
        fetchAudit(auditLimit);
      } else {
        showToast((data as unknown as { error?: string }).error || 'Failed to delete user', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete user', 'error');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // ─── Permission Checkboxes Render ──────────────────────────────────

  const renderPermissionCheckboxes = (
    perms: Record<string, boolean>,
    role: string,
    onToggle: (perm: string) => void,
  ) => (
    <div>
      {PERMISSION_CATEGORIES.map((cat) => (
        <div key={cat.label} style={STYLES.permCategory}>
          <div style={STYLES.permCatLabel}>{cat.label}</div>
          <div style={STYLES.permGrid}>
            {cat.perms.map((perm) => (
              <label
                key={perm}
                style={{
                  ...STYLES.checkboxRow,
                  opacity: role === 'custom' ? 1 : 0.7,
                  cursor: role === 'custom' ? 'pointer' : 'default',
                }}
              >
                <input
                  type="checkbox"
                  style={STYLES.checkbox}
                  checked={!!perms[perm]}
                  disabled={role !== 'custom'}
                  onChange={() => onToggle(perm)}
                />
                {perm}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div style={STYLES.container}>
      {/* Left Panel: Users Table */}
      <div style={STYLES.leftPanel}>
        <div style={STYLES.header}>
          <h1 style={STYLES.title}>User Management</h1>
          <button
            style={STYLES.btn('primary')}
            onClick={openCreateModal}
          >
            + Create User
          </button>
        </div>
        <p style={STYLES.subtitle}>Manage user accounts and permissions</p>

        {error && (
          <div style={{ color: 'var(--red)', marginBottom: '12px', fontSize: '13px' }}>{error}</div>
        )}

        {loading ? (
          <div className="loading">Loading users...</div>
        ) : (
          <div style={STYLES.table}>
            {users.map((u) => (
              <div key={u.username} style={STYLES.row}>
                <div style={STYLES.userInfo}>
                  <div style={STYLES.username}>{u.username}</div>
                  <div style={STYLES.meta}>
                    <span style={roleBadgeStyle(u.role)}>{u.role}</span>
                    {' '}&middot;{' '}
                    {countPermissions(u.permissions)} permissions
                    {' '}&middot; Last login: {formatDateShort(u.last_login)}
                  </div>
                </div>
                <div style={STYLES.actions}>
                  <button
                    style={STYLES.iconBtn()}
                    title="Edit user"
                    onClick={() => openEditModal(u)}
                  >
                    &#9881;
                  </button>
                  <button
                    style={STYLES.iconBtn(true)}
                    title="Delete user"
                    onClick={() => openDeleteModal(u)}
                  >
                    &#10005;
                  </button>
                </div>
              </div>
            ))}
            {users.length === 0 && (
              <div style={STYLES.empty}>No users found</div>
            )}
          </div>
        )}
      </div>

      {/* Right Panel: Audit Log */}
      <div style={STYLES.rightPanel}>
        <h1 style={STYLES.title}>Audit Log</h1>
        <p style={STYLES.subtitle}>Recent security-relevant events</p>

        {auditLoading && auditEntries.length === 0 ? (
          <div className="loading">Loading audit log...</div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {auditEntries.map((line, i) => {
              const entry = parseAuditLine(line);
              if (!entry) {
                return (
                  <div key={i} style={{ fontSize: '11px', color: 'var(--fg-subtle)', padding: '2px 0' }}>
                    {line}
                  </div>
                );
              }
              const color = auditActionColor(entry.action);
              return (
                <div key={i} style={STYLES.auditEntry(color)}>
                  <span style={STYLES.auditTime}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                  <span style={STYLES.auditAction(color)}>{entry.action}</span>
                  {' '}
                  <span style={{ color: 'var(--fg-muted)' }}>{entry.username}</span>
                  {entry.details && (
                    <>
                      {' — '}
                      <span style={{ color: 'var(--fg-subtle)' }}>{entry.details}</span>
                    </>
                  )}
                </div>
              );
            })}
            {auditEntries.length === 0 && !auditLoading && (
              <div style={STYLES.empty}>No audit entries</div>
            )}
            {auditEntries.length >= auditLimit && (
              <button
                style={{ ...STYLES.btn('ghost', true), marginTop: '8px', width: '100%' }}
                onClick={loadMoreAudit}
                disabled={auditLoading}
              >
                {auditLoading ? 'Loading...' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ──────── Create User Modal ──────── */}
      {showCreate && (
        <div style={STYLES.modalOverlay} onClick={() => setShowCreate(false)}>
          <form
            style={STYLES.modalCard}
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreate}
          >
            <div style={STYLES.modalTitle}>Create User</div>

            <div style={STYLES.formGroup}>
              <label style={STYLES.label}>Username</label>
              <input
                style={STYLES.input}
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
                placeholder="Username"
                autoComplete="off"
                autoFocus
              />
            </div>

            <div style={STYLES.formGroup}>
              <label style={STYLES.label}>Password</label>
              <div style={STYLES.passwordRow}>
                <input
                  style={STYLES.input}
                  type={showPassword ? 'text' : 'password'}
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="Password (min 8 characters)"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  style={STYLES.toggleBtn}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div style={STYLES.formGroup}>
              <label style={STYLES.label}>Role</label>
              <div style={STYLES.roleBtns}>
                {(['admin', 'viewer', 'custom'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    style={STYLES.roleBtn(createRole === r)}
                    onClick={() => setCreateRoleWithPreset(r)}
                  >
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div style={STYLES.formGroup}>
              <label style={STYLES.label}>
                Permissions {createRole !== 'custom' && '(set by role)'}
              </label>
              {renderPermissionCheckboxes(createPerms, createRole, toggleCreatePerm)}
            </div>

            {createError && (
              <div style={{ color: 'var(--red)', fontSize: '12px', marginBottom: '8px' }}>{createError}</div>
            )}

            <div style={STYLES.modalActions}>
              <button
                type="button"
                style={STYLES.btn('ghost')}
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={STYLES.btn('primary')}
                disabled={createSubmitting}
              >
                {createSubmitting ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ──────── Edit User Modal ──────── */}
      {showEdit && editUser && (
        <div style={STYLES.modalOverlay} onClick={() => setShowEdit(false)}>
          <form
            style={STYLES.modalCard}
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleEditSave}
          >
            <div style={STYLES.modalTitle}>Edit User: {editUser.username}</div>

            <div style={STYLES.formGroup}>
              <label style={STYLES.label}>Role</label>
              <div style={STYLES.roleBtns}>
                {(['admin', 'viewer', 'custom'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    style={STYLES.roleBtn(editRole === r)}
                    onClick={() => setEditRoleWithPreset(r)}
                  >
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div style={STYLES.formGroup}>
              <label style={STYLES.label}>
                Permissions {editRole !== 'custom' && '(set by role)'}
              </label>
              {renderPermissionCheckboxes(editPerms, editRole, toggleEditPerm)}
            </div>

            {/* Password Reset sub-section */}
            <div style={STYLES.resetSubSection}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>Reset Password</span>
                <button
                  type="button"
                  style={STYLES.btn('ghost', true)}
                  onClick={() => setShowResetPwd(!showResetPwd)}
                >
                  {showResetPwd ? 'Cancel' : 'Reset'}
                </button>
              </div>
              {showResetPwd && (
                <div>
                  <div style={STYLES.passwordRow}>
                    <input
                      style={STYLES.input}
                      type="password"
                      value={resetNewPwd}
                      onChange={(e) => setResetNewPwd(e.target.value)}
                      placeholder="New password (min 8 chars)"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      style={STYLES.btn('ghost', true)}
                      onClick={handleResetPassword}
                      disabled={resetSubmitting}
                    >
                      {resetSubmitting ? 'Resetting...' : 'Reset'}
                    </button>
                  </div>
                  {resetError && (
                    <div style={{ color: 'var(--red)', fontSize: '11px', marginTop: '4px' }}>{resetError}</div>
                  )}
                </div>
              )}
            </div>

            {editError && (
              <div style={{ color: 'var(--red)', fontSize: '12px', marginBottom: '8px' }}>{editError}</div>
            )}

            <div style={STYLES.modalActions}>
              <button
                type="button"
                style={STYLES.btn('ghost')}
                onClick={() => setShowEdit(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={STYLES.btn('primary')}
                disabled={editSubmitting}
              >
                {editSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ──────── Delete Confirmation Modal ──────── */}
      {showDelete && deleteUser && (
        <div style={STYLES.modalOverlay} onClick={() => setShowDelete(false)}>
          <div
            style={{ ...STYLES.modalCard, minWidth: '380px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={STYLES.modalTitle}>Delete User</div>
            <p style={{ color: 'var(--fg-muted)', fontSize: '13px', marginBottom: '4px' }}>
              Are you sure you want to delete user{' '}
              <strong style={{ color: 'var(--fg)' }}>{deleteUser.username}</strong>?
            </p>
            <p style={{ color: 'var(--red)', fontSize: '12px' }}>
              This action cannot be undone.
            </p>
            <div style={STYLES.modalActions}>
              <button
                type="button"
                style={STYLES.btn('ghost')}
                onClick={() => setShowDelete(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={STYLES.btn('danger')}
                onClick={handleDelete}
                disabled={deleteSubmitting}
              >
                {deleteSubmitting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ──────── Toast Notification ──────── */}
      {toast && (
        <div style={STYLES.toast(toast.type)}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
