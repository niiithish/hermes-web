'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/lib/api-client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentProfile {
  name: string;
  active: boolean;
  gateway?: string;
  model?: string;
  alias?: string;
}

// ─── Shared styles ───────────────────────────────────────────────────────────

const pageHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: '16px',
};

const pageTitleStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
  color: 'var(--fg)',
};

const pageSubtitleStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--fg-muted)',
  marginTop: '4px',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
  color: 'var(--fg)',
};

const cardGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: '16px',
};

const statRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 0',
  borderBottom: '1px solid var(--border)',
  fontSize: '13px',
};

const statLabelStyle: React.CSSProperties = {
  color: 'var(--fg-muted)',
  flexShrink: 0,
  marginRight: '12px',
};

const statValueStyle: React.CSSProperties = {
  color: 'var(--fg)',
  fontWeight: 500,
  textAlign: 'right',
};

const btnGhostStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  padding: '6px 16px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg-panel)',
  color: 'var(--fg)',
  fontFamily: 'var(--font)',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s',
  whiteSpace: 'nowrap' as const,
};

const btnPrimaryStyle: React.CSSProperties = {
  ...btnGhostStyle,
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
};

const btnSmStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '11px',
};

const btnDangerStyle: React.CSSProperties = {
  ...btnGhostStyle,
  ...btnSmStyle,
  color: 'var(--red)',
  borderColor: 'var(--red)',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 6px',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
  borderRadius: '4px',
  border: '1px solid var(--border)',
  background: 'var(--accent-dim)',
  color: 'var(--accent)',
};

const statusOkStyle: React.CSSProperties = {
  color: 'var(--green)',
};

const statusOffStyle: React.CSSProperties = {
  color: 'var(--fg-muted)',
};

const errorStyle: React.CSSProperties = {
  color: 'var(--red)',
  fontSize: '13px',
  padding: '8px 0',
};

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.6)',
  zIndex: 999,
};

const modalCardStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: '24px',
  minWidth: '360px',
  maxWidth: '90vw',
  boxShadow: 'var(--shadow)',
};

const modalTitleStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  marginBottom: '16px',
  color: 'var(--fg-base)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--fg)',
  fontFamily: 'var(--font)',
  fontSize: '12px',
  outline: 'none',
  marginBottom: '12px',
};

const toastStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: '24px',
  right: '24px',
  padding: '10px 20px',
  borderRadius: 'var(--radius)',
  fontSize: '13px',
  fontWeight: 500,
  zIndex: 9999,
  boxShadow: 'var(--shadow)',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const router = useRouter();

  // Data state
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createMode, setCreateMode] = useState<'fresh' | 'clone' | null>(null);
  const [cloneSource, setCloneSource] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    title: string;
    onConfirm: () => void;
  } | null>(null);

  // ── Load agents ────────────────────────────────────────────────────────

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ ok: boolean; profiles: AgentProfile[] }>('/api/profiles');
      if (res.ok && res.profiles) {
        setAgents(res.profiles);
      } else {
        setAgents([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agents');
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // ── Toast helper ───────────────────────────────────────────────────────

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Confirm helper ─────────────────────────────────────────────────────

  const confirm = useCallback((message: string, title: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmDialog({
        message,
        title,
        onConfirm: () => {
          setConfirmDialog(null);
          resolve(true);
        },
      });
      // Store cancel handler
      const cancelHandler = () => {
        setConfirmDialog(null);
        resolve(false);
      };
      // Attach to window for overlay click
      (window as any).__confirmCancel = cancelHandler;
    });
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────

  const handleDeleteAgent = useCallback(async (name: string) => {
    const ok = await confirm(
      `Delete agent "${name}"? This cannot be undone.`,
      'Delete Agent'
    );
    if (!ok) return;
    try {
      const res = await api.del<{ ok: boolean; error?: string }>(`/api/profiles/${encodeURIComponent(name)}`);
      if (res.ok) {
        showToast(`Agent ${name} deleted`, 'success');
        loadAgents();
      } else {
        showToast(res.error || 'Failed to delete', 'error');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to delete', 'error');
    }
  }, [confirm, loadAgents, showToast]);

  const handleSetDefault = useCallback(async (name: string) => {
    const ok = await confirm(
      `Set "${name}" as default profile?`,
      'Set Default'
    );
    if (!ok) return;
    try {
      await api.post('/api/profiles/use', { profile: name });
      showToast(`Default agent set to "${name}"`, 'success');
      loadAgents();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to set default', 'error');
    }
  }, [confirm, loadAgents, showToast]);

  // ── Create Agent ───────────────────────────────────────────────────────

  const handleOpenCreate = useCallback(() => {
    setCreateName('');
    setCreateMode(null);
    setCloneSource('');
    setCreateError(null);
    setCreateSubmitting(false);
    setShowCreateModal(true);
  }, []);

  const handleCreateSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (createSubmitting) return;

    const safeName = createName.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
    if (!safeName) {
      setCreateError('Please enter an agent name (letters, numbers, hyphens, underscores).');
      return;
    }

    setCreateSubmitting(true);
    setCreateError(null);

    const body: Record<string, string> = { name: safeName };

    if (createMode === 'clone') {
      const source = (cloneSource || 'david').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!source) {
        setCreateError('Invalid source profile name.');
        setCreateSubmitting(false);
        return;
      }
      body.cloneArg = '--clone-from';
      body.cloneSource = source;
    }

    try {
      const res = await api.post<{ ok: boolean; error?: string }>('/api/profiles/create', body);
      if (res.ok) {
        showToast(`Agent ${safeName} created!`, 'success');
        setShowCreateModal(false);
        loadAgents();
      } else {
        setCreateError(res.error || 'Failed to create agent');
      }
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create agent');
    } finally {
      setCreateSubmitting(false);
    }
  }, [createName, cloneSource, createMode, createSubmitting, loadAgents, showToast]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px', height: '100%', overflowY: 'auto' }}>
      {/* ── Page Header ────────────────────────────────────────────────── */}
      <div style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>Agents</div>
          <div style={pageSubtitleStyle}>Manage your Hermes profiles</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={btnPrimaryStyle} onClick={handleOpenCreate}>
            + Create Agent
          </button>
          <button style={btnGhostStyle} onClick={loadAgents}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Error message ──────────────────────────────────────────────── */}
      {error && <div style={errorStyle}>{error}</div>}

      {/* ── Loading ────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', color: 'var(--fg-muted)', fontStyle: 'italic' }}>
          Loading agents...
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────────────────── */}
      {!loading && !error && agents.length === 0 && (
        <div style={{ ...cardStyle, alignItems: 'center', justifyContent: 'center', padding: '40px', color: 'var(--fg-muted)' }}>
          No agents found. Create your first agent profile to get started.
        </div>
      )}

      {/* ── Agent cards grid ───────────────────────────────────────────── */}
      {!loading && agents.length > 0 && (
        <div style={cardGridStyle}>
          {agents.map((p) => {
            const isRunning = p.gateway === 'running';
            return (
              <div key={p.name} style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div style={cardTitleStyle}>{p.name}</div>
                  {p.active && <span style={badgeStyle}>default</span>}
                </div>
                <div style={statRowStyle}>
                  <span style={statLabelStyle}>Status</span>
                  <span style={{ ...statValueStyle, ...(isRunning ? statusOkStyle : statusOffStyle) }}>
                    {isRunning ? '● Running' : '○ Stopped'}
                  </span>
                </div>
                <div style={statRowStyle}>
                  <span style={statLabelStyle}>Model</span>
                  <span style={statValueStyle}>{p.model || '—'}</span>
                </div>
                {p.alias && (
                  <div style={statRowStyle}>
                    <span style={statLabelStyle}>Alias</span>
                    <span style={statValueStyle}>{p.alias}</span>
                  </div>
                )}
                <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    style={{ ...btnGhostStyle, ...btnSmStyle }}
                    onClick={() => router.push(`/agents/${encodeURIComponent(p.name)}`)}
                  >
                    Open
                  </button>
                  {!p.active && (
                    <button
                      style={{ ...btnGhostStyle, ...btnSmStyle }}
                      onClick={() => handleSetDefault(p.name)}
                    >
                      Set Default
                    </button>
                  )}
                  {p.name !== 'default' && (
                    <button
                      style={btnDangerStyle}
                      onClick={() => handleDeleteAgent(p.name)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create Agent Modal ─────────────────────────────────────────── */}
      {showCreateModal && (
        <div
          style={modalOverlayStyle}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false); }}
        >
          <div style={{ ...modalCardStyle, width: '420px' }}>
            <div style={modalTitleStyle}>Create Agent</div>
            <div style={{ fontSize: '13px', color: 'var(--fg-muted)', marginBottom: '16px' }}>
              Create a new Hermes profile.
            </div>

            <form onSubmit={handleCreateSubmit}>
              <input
                type="text"
                placeholder="Agent name (e.g. worker, analyst)"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                style={inputStyle}
                autoFocus
              />

              {createMode === 'clone' && (
                <input
                  type="text"
                  placeholder="Source profile (e.g. david)"
                  value={cloneSource}
                  onChange={(e) => setCloneSource(e.target.value)}
                  style={inputStyle}
                />
              )}

              {createError && (
                <div style={{ ...errorStyle, marginBottom: '8px' }}>{createError}</div>
              )}

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  style={btnGhostStyle}
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={{ ...btnGhostStyle, ...(createMode === 'clone' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}
                  onClick={() => setCreateMode(createMode === 'clone' ? null : 'clone')}
                >
                  {createMode === 'clone' ? '✓ Clone From' : 'Clone From...'}
                </button>
                <button
                  type="submit"
                  style={{ ...btnPrimaryStyle, opacity: createSubmitting ? 0.7 : 1 }}
                  disabled={createSubmitting}
                >
                  {createSubmitting ? 'Creating...' : (createMode === 'clone' ? 'Clone' : 'Create Fresh')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Confirm Dialog ─────────────────────────────────────────────── */}
      {confirmDialog && (
        <div
          style={modalOverlayStyle}
          onClick={() => {
            (window as any).__confirmCancel?.();
          }}
        >
          <div style={{ ...modalCardStyle, width: '380px' }}>
            <div style={modalTitleStyle}>{confirmDialog.title}</div>
            <div style={{ fontSize: '13px', color: 'var(--fg-muted)', marginBottom: '16px' }}>
              {confirmDialog.message}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                style={btnGhostStyle}
                onClick={() => {
                  (window as any).__confirmCancel?.();
                }}
              >
                Cancel
              </button>
              <button
                style={btnPrimaryStyle}
                onClick={() => confirmDialog.onConfirm()}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ──────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          ...toastStyle,
          background: toast.type === 'success' ? 'var(--green)' : toast.type === 'error' ? 'var(--red)' : 'var(--accent)',
          color: '#fff',
        }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
