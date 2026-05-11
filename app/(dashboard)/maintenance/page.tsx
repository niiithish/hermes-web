'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '@/app/lib/api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HealthResult {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

interface HCIUpdateInfo {
  ok: boolean;
  local: {
    version: string;
    hash: string;
  };
  branch: string;
  behind: number;
  commits: Array<{
    hash: string;
    shortHash: string;
    msg: string;
    author: string;
    date: string;
  }>;
}

interface DoctorSection {
  name: string;
  items: Array<{
    status: 'pass' | 'fail' | 'warn';
    text: string;
    suggestion: string | null;
  }>;
}

interface DoctorParsed {
  sections: DoctorSection[];
  totalPass: number;
  totalFail: number;
  totalWarn: number;
}

interface CommitDiff {
  ok: boolean;
  commit: { shortHash: string; msg: string; author: string; date: string };
  shortstat: string;
  files: Array<{ file: string; added: number; removed: number }>;
  error?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function parseDoctorOutput(raw: string): DoctorParsed {
  const lines = raw.split(/\r?\n/);
  const sections: DoctorSection[] = [];
  let current: DoctorSection | null = null;
  let totalPass = 0,
    totalFail = 0,
    totalWarn = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[┌└─│┐┘]+$/.test(trimmed)) continue;
    if (/🩺/.test(trimmed)) continue;
    if (!trimmed) {
      if (current && current.items.length) {
        sections.push(current);
        current = null;
      }
      continue;
    }
    const secMatch = trimmed.match(/^◆\s+(.+)/);
    if (secMatch) {
      if (current && current.items.length) sections.push(current);
      current = { name: secMatch[1], items: [] };
      continue;
    }
    if (!current) continue;
    const itemMatch = trimmed.match(/^([✓✗⚠])\s+(.+)/);
    if (itemMatch) {
      const status =
        itemMatch[1] === '✓' ? 'pass' : itemMatch[1] === '✗' ? 'fail' : 'warn';
      if (status === 'pass') totalPass++;
      else if (status === 'fail') totalFail++;
      else totalWarn++;
      current.items.push({ status, text: itemMatch[2], suggestion: null });
      continue;
    }
    const sugMatch = trimmed.match(/^→\s+(.+)/);
    if (sugMatch && current.items.length) {
      current.items[current.items.length - 1].suggestion = sugMatch[1];
    }
  }
  if (current && current.items.length) sections.push(current);
  return { sections, totalPass, totalFail, totalWarn };
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  container: {
    padding: '24px',
    height: '100%',
    overflowY: 'auto',
  } as React.CSSProperties,

  pageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px',
  } as React.CSSProperties,

  pageTitle: {
    fontSize: '20px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--fg)',
  } as React.CSSProperties,

  pageSubtitle: {
    fontSize: '13px',
    color: 'var(--fg-muted)',
    marginTop: '4px',
  } as React.CSSProperties,

  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px',
    marginBottom: '16px',
  } as React.CSSProperties,

  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius, 6px)',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
  } as React.CSSProperties,

  cardTitle: {
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--fg-muted)',
    marginBottom: '12px',
  } as React.CSSProperties,

  cardActions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: 'auto',
    paddingTop: '12px',
  } as React.CSSProperties,

  btnGhost: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '6px 14px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius, 6px)',
    background: 'var(--bg-panel)',
    color: 'var(--fg)',
    fontFamily: 'var(--font, monospace)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,

  btnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '6px 14px',
    border: 'none',
    borderRadius: 'var(--radius, 6px)',
    background: 'var(--accent)',
    color: '#fff',
    fontFamily: 'var(--font, monospace)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,

  btnSm: {
    padding: '3px 8px',
    fontSize: '11px',
  } as React.CSSProperties,

  btnOutline: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '6px 14px',
    border: '1px solid var(--accent)',
    borderRadius: 'var(--radius, 6px)',
    background: 'transparent',
    color: 'var(--accent)',
    fontFamily: 'var(--font, monospace)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,

  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
    borderBottom: '1px solid var(--border)',
  } as React.CSSProperties,

  statRowLast: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
  } as React.CSSProperties,

  statLabel: {
    fontSize: '12px',
    color: 'var(--fg-muted)',
  } as React.CSSProperties,

  statValue: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--fg)',
    textAlign: 'right',
  } as React.CSSProperties,

  statValueMono: {
    fontSize: '11px',
    fontWeight: 500,
    color: 'var(--fg)',
    textAlign: 'right',
    fontFamily: 'var(--font-mono, monospace)',
  } as React.CSSProperties,

  statItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  } as React.CSSProperties,

  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 6px',
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    borderRadius: '4px',
    border: '1px solid var(--border)',
  } as React.CSSProperties,

  badgeWarning: {
    background: 'rgba(255,172,2,0.15)',
    color: 'var(--warning, #eab308)',
    borderColor: 'var(--warning, #eab308)',
  } as React.CSSProperties,

  statusOk: {
    color: 'var(--success, #22c55e)',
  } as React.CSSProperties,

  statusFail: {
    color: 'var(--danger, #ef4444)',
  } as React.CSSProperties,

  statusWarn: {
    color: 'var(--warning, #eab308)',
  } as React.CSSProperties,

  latencyText: {
    fontSize: '10px',
    opacity: 0.6,
  } as React.CSSProperties,

  // Version info grid
  versionGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    marginBottom: '12px',
  } as React.CSSProperties,

  // Doctor output
  doctorSummary: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
    padding: '8px 10px',
    background: 'var(--bg-input)',
    borderRadius: 'var(--radius, 6px)',
    marginBottom: '8px',
    fontSize: '12px',
  } as React.CSSProperties,

  doctorSummaryItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontWeight: 600,
  } as React.CSSProperties,

  doctorSection: {
    marginBottom: '6px',
  } as React.CSSProperties,

  doctorSectionHeader: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--fg)',
    padding: '4px 0',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  } as React.CSSProperties,

  doctorItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '6px',
    padding: '2px 0',
    paddingLeft: '12px',
    fontSize: '11px',
  } as React.CSSProperties,

  doctorItemText: {
    color: 'var(--fg-muted)',
    flex: 1,
  } as React.CSSProperties,

  doctorSuggestion: {
    fontSize: '11px',
    color: 'var(--fg-subtle)',
    fontStyle: 'italic',
    paddingLeft: '30px',
    paddingBottom: '4px',
  } as React.CSSProperties,

  // Pre formatted output
  preOutput: {
    fontSize: '10px',
    whiteSpace: 'pre-wrap',
    maxHeight: '300px',
    overflowY: 'auto',
    color: 'var(--fg-muted)',
    fontFamily: 'var(--font-mono, monospace)',
    background: 'var(--bg-input)',
    padding: '8px',
    borderRadius: 'var(--radius, 6px)',
  } as React.CSSProperties,

  // Loading
  loading: {
    fontSize: '12px',
    color: 'var(--fg-muted)',
    fontStyle: 'italic',
    padding: '8px 0',
  } as React.CSSProperties,

  // Error
  errorMsg: {
    fontSize: '12px',
    color: 'var(--danger, #ef4444)',
    padding: '8px 0',
  } as React.CSSProperties,

  // All OK
  allOk: {
    marginTop: '8px',
    fontSize: '11px',
    color: 'var(--fg-muted)',
  } as React.CSSProperties,

  // Modal
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.6)',
    zIndex: 999,
  } as React.CSSProperties,

  modalCard: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg, 12px)',
    padding: '24px',
    minWidth: '360px',
    maxWidth: '90vw',
    maxHeight: '85vh',
    overflowY: 'auto',
    boxShadow: 'var(--shadow)',
  } as React.CSSProperties,

  modalTitle: {
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '16px',
    color: 'var(--fg-base)',
  } as React.CSSProperties,

  modalMessage: {
    fontSize: '13px',
    color: 'var(--fg-muted)',
    marginBottom: '16px',
    whiteSpace: 'pre-wrap',
  } as React.CSSProperties,

  modalActions: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
  } as React.CSSProperties,

  // Commit card in modal
  commitCard: {
    padding: '8px 10px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius, 6px)',
    marginBottom: '6px',
    background: 'var(--bg-input)',
  } as React.CSSProperties,

  commitHash: {
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: '11px',
    color: 'var(--accent)',
    marginRight: '8px',
  } as React.CSSProperties,

  // Toast
  toastBase: {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    padding: '10px 20px',
    borderRadius: 'var(--radius, 6px)',
    fontSize: '13px',
    fontWeight: 500,
    zIndex: 1000,
  } as React.CSSProperties,

  // File input label (styled as button)
  fileLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '6px 14px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius, 6px)',
    background: 'var(--bg-panel)',
    color: 'var(--fg)',
    fontFamily: 'var(--font, monospace)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,

  // SSE log
  sseLog: {
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: '12px',
    lineHeight: 1.8,
    maxHeight: '400px',
    overflowY: 'auto',
    background: 'var(--bg-input)',
    padding: '12px',
    borderRadius: 'var(--radius, 6px)',
    whiteSpace: 'pre-wrap',
    color: 'var(--fg-muted)',
  } as React.CSSProperties,
};

// ─── Component ─────────────────────────────────────────────────────────────────

export default function MaintenancePage() {
  // ── Health Check state ───────────────────────────────────────────────────────
  const [healthResults, setHealthResults] = useState<HealthResult[] | null>(null);
  const [healthRunning, setHealthRunning] = useState(false);

  // ── HCI Update state ────────────────────────────────────────────────────────
  const [hciInfo, setHciInfo] = useState<HCIUpdateInfo | null>(null);
  const [hciLoading, setHciLoading] = useState(false);

  // ── Doctor state ────────────────────────────────────────────────────────────
  const [doctorResult, setDoctorResult] = useState<string>('');
  const [doctorParsed, setDoctorParsed] = useState<DoctorParsed | null>(null);
  const [doctorRunning, setDoctorRunning] = useState(false);

  // ── Dump state ──────────────────────────────────────────────────────────────
  const [dumpResult, setDumpResult] = useState<string>('');
  const [dumpLoading, setDumpLoading] = useState(false);

  // ── Hermes Update state ─────────────────────────────────────────────────────
  const [hermesVersion, setHermesVersion] = useState<string>('—');
  const [updateResult, setUpdateResult] = useState<string>('');
  const [updateRunning, setUpdateRunning] = useState(false);

  // ── Backup state ────────────────────────────────────────────────────────────
  const [backupResult, setBackupResult] = useState<string>('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  // ── Modal state ─────────────────────────────────────────────────────────────
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; title: string } | null>(null);
  const [diffModal, setDiffModal] = useState<CommitDiff | null>(null);
  const [sseModal, setSseModal] = useState<{ title: string; log: string; completed: boolean } | null>(null);

  // ── Toast ───────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Confirm Dialog ──────────────────────────────────────────────────────────

  const confirm = useCallback((message: string, title: string): Promise<boolean> => {
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirmDialog({ message, title });
    });
  }, []);

  const handleConfirmYes = useCallback(() => {
    confirmResolveRef.current?.(true);
    confirmResolveRef.current = null;
    setConfirmDialog(null);
  }, []);

  const handleConfirmNo = useCallback(() => {
    confirmResolveRef.current?.(false);
    confirmResolveRef.current = null;
    setConfirmDialog(null);
  }, []);

  // ── Health Check ────────────────────────────────────────────────────────────

  const runHealthCheck = useCallback(async () => {
    const ok = await confirm('Run health check on all API endpoints?', 'Health Check');
    if (!ok) return;

    setHealthRunning(true);
    setHealthResults(null);

    const endpoints = [
      { name: 'Health', url: '/api/health' },
      { name: 'System', url: '/api/system/health' },
      { name: 'Auth Status', url: '/api/auth/status' },
      { name: 'Profiles', url: '/api/profiles' },
      { name: 'Sessions', url: '/api/sessions' },
    ];

    const results: HealthResult[] = [];

    for (const ep of endpoints) {
      const start = performance.now();
      try {
        const res = await api.get<{ ok?: boolean; error?: string }>(ep.url);
        const ms = Math.round(performance.now() - start);
        results.push({ name: ep.name, ok: res.ok !== false, ms, error: (res as { error?: string }).error });
      } catch (e: unknown) {
        const ms = Math.round(performance.now() - start);
        results.push({ name: ep.name, ok: false, ms, error: e instanceof Error ? e.message : 'Unknown error' });
      }
    }

    setHealthResults(results);
    setHealthRunning(false);
  }, [confirm]);

  const restartHCI = useCallback(async () => {
    const ok = await confirm('Restart HCI? This will take ~2 seconds.', 'Restart');
    if (!ok) return;

    try {
      const res = await api.post<{ ok: boolean; error?: string }>('/api/hci-restart');
      if (res.ok) {
        showToast('HCI restarting...', 'success');
        setTimeout(() => window.location.reload(), 5000);
      } else {
        showToast(res.error || 'Restart failed', 'error');
      }
    } catch (e: unknown) {
      showToast('Restart failed: ' + (e instanceof Error ? e.message : 'Unknown error'), 'error');
    }
  }, [confirm, showToast]);

  // ── HCI Update ──────────────────────────────────────────────────────────────

  const loadHCIInfo = useCallback(async () => {
    try {
      const res = await api.get<HCIUpdateInfo>('/api/hci/check-update');
      if (res.ok) {
        setHciInfo(res);
      }
    } catch {
      // Silent fail
    }
  }, []);

  const checkHCIUpdates = useCallback(async () => {
    setHciLoading(true);
    try {
      const res = await api.get<HCIUpdateInfo>('/api/hci/check-update');
      if (!res.ok) {
        alert(res.ok === false ? 'Failed to check updates' : 'Error');
        return;
      }
      setHciInfo(res);
      if (res.behind > 0) {
        setDiffModal(null); // We'll show commits in a modal-like view
        showCommitListModal(res);
      } else {
        showToast(`Already at latest commit on ${res.branch}`, 'info');
      }
    } catch (e: unknown) {
      showToast('Failed to check updates', 'error');
    } finally {
      setHciLoading(false);
    }
  }, [showToast]);

  const showCommitListModal = useCallback((data: HCIUpdateInfo) => {
    setSseModal(null); // clear any existing
    // Reuse the confirm dialog infrastructure but customize the message
    confirmResolveRef.current = (v: boolean) => {
      confirmResolveRef.current = null;
      setConfirmDialog(null);
    };
    setConfirmDialog({
      title: `${data.behind} commit(s) behind on ${data.branch}`,
      message: '__COMMIT_LIST__' + JSON.stringify(data.commits),
    });
  }, []);

  const showCommitDiffModal = useCallback(async (hash: string) => {
    try {
      const res = await api.get<CommitDiff>(`/api/hci/commit/${hash}/diff`);
      if (!res.ok) {
        showToast(res.error || 'Failed to load diff', 'error');
        return;
      }
      setDiffModal(res);
    } catch {
      showToast('Failed to load diff', 'error');
    }
  }, [showToast]);

  const runSSEUpdate = useCallback(async (endpoint: string, title: string) => {
    setSseModal({ title, log: '', completed: false });
    const logLines: string[] = [];
    const appendLog = (text: string) => {
      logLines.push(text);
      setSseModal((prev) => prev ? { ...prev, log: logLines.join('\n') } : null);
    };

    const safetyTimeout = setTimeout(() => {
      appendLog('\n⚠ Update timed out. You may need to restart manually.');
    }, 120000);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const res = await fetch(endpoint, { method: 'POST', headers, body: '{}', credentials: 'include' });
      const reader = res.body?.getReader();
      if (!reader) { appendLog('No response body'); return; }
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'progress') appendLog(evt.line);
            if (evt.type === 'warning') appendLog('⚠ ' + evt.line);
            if (evt.type === 'error') appendLog('❌ ' + evt.message);
            if (evt.type === 'done') {
              appendLog('\n✅ ' + evt.message);
              setSseModal((prev) => prev ? { ...prev, completed: true, log: logLines.join('\n') } : null);
              setTimeout(() => window.location.reload(), 2000);
            }
          } catch { /* skip bad JSON */ }
        }
      }
    } catch (e: unknown) {
      appendLog('\n❌ Connection error: ' + (e instanceof Error ? e.message : 'Unknown error'));
    }
    clearTimeout(safetyTimeout);
  }, []);

  const updateHCI = useCallback(async () => {
    const ok = await confirm('Update HCI? This will git pull, npm install, and rebuild (~30s).', 'Update');
    if (!ok) return;
    runSSEUpdate('/api/hci/update', 'HCI Update');
  }, [confirm, runSSEUpdate]);

  const rollbackHCI = useCallback(async () => {
    const ok = await confirm('Rollback HCI? This will revert to the previous commit.', 'Rollback');
    if (!ok) return;
    runSSEUpdate('/api/hci/rollback', 'HCI Rollback');
  }, [confirm, runSSEUpdate]);

  const checkoutCommit = useCallback(async (hash: string) => {
    setConfirmDialog(null);
    confirmResolveRef.current = null;
    const ok = await confirm(`Checkout to ${hash}? This will run npm install and rebuild.\n\nThe server will restart.`, 'Checkout Commit');
    if (!ok) return;
    runSSEUpdate(`/api/hci/update/commit/${hash}`, `Checkout ${hash}`);
  }, [confirm, runSSEUpdate]);

  // ── Doctor ───────────────────────────────────────────────────────────────────

  const runDoctor = useCallback(async () => {
    const ok = await confirm('Run diagnostics? This is read-only.', 'Diagnostics');
    if (!ok) return;

    setDoctorRunning(true);
    setDoctorResult('');
    setDoctorParsed(null);

    try {
      const res = await fetch('/api/doctor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fix: false }),
      });

      if (!res.ok) {
        setDoctorResult(`HTTP ${res.status}`);
        setDoctorRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) { setDoctorResult('No response body'); setDoctorRunning(false); return; }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullOutput = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() || '';
        for (const line of parts) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'progress') {
              fullOutput += data.line + '\n';
            } else if (data.type === 'done') {
              fullOutput = data.output || fullOutput;
            }
          } catch { /* skip */ }
        }
      }

      const trimmed = fullOutput.trim();
      if (trimmed) {
        setDoctorResult(trimmed);
        setDoctorParsed(parseDoctorOutput(trimmed));
      } else {
        setDoctorResult('No output received');
      }
    } catch (e: unknown) {
      setDoctorResult(e instanceof Error ? e.message : 'Unknown error');
    }
    setDoctorRunning(false);
  }, [confirm]);

  // ── Dump ─────────────────────────────────────────────────────────────────────

  const runDump = useCallback(async () => {
    const ok = await confirm('Generate system dump? This creates a summary of current configuration.', 'Generate Dump');
    if (!ok) return;

    setDumpLoading(true);
    setDumpResult('');

    try {
      const res = await api.get<{ output?: string }>('/api/dump');
      setDumpResult(res.output || 'No output');
    } catch (e: unknown) {
      setDumpResult(e instanceof Error ? e.message : 'Unknown error');
    }
    setDumpLoading(false);
  }, [confirm]);

  // ── Hermes Update ────────────────────────────────────────────────────────────

  const loadHermesVersion = useCallback(async () => {
    try {
      const res = await api.get<{ ok: boolean; hermes_version?: string }>('/api/system/health');
      if (res.ok && res.hermes_version) {
        setHermesVersion(res.hermes_version);
      }
    } catch { /* silent */ }
  }, []);

  const updateHermes = useCallback(async () => {
    const ok = await confirm('Update Hermes? This may take a minute.', 'Update Hermes');
    if (!ok) return;

    setUpdateRunning(true);
    setUpdateResult('');

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const res = await fetch('/api/update', { method: 'POST', headers, body: '{}', credentials: 'include' });

      if (!res.ok) {
        setUpdateResult(`HTTP ${res.status}`);
        setUpdateRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) { setUpdateResult('No response body'); setUpdateRunning(false); return; }

      const decoder = new TextDecoder();
      let buffer = '';
      let output = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'progress') output += evt.line + '\n';
            if (evt.type === 'done') output += '\n✅ ' + evt.message;
          } catch { /* skip */ }
        }
      }

      setUpdateResult(output || 'Update completed');
      showToast('Hermes update completed', 'success');
    } catch (e: unknown) {
      setUpdateResult(e instanceof Error ? e.message : 'Unknown error');
    }
    setUpdateRunning(false);
  }, [confirm, showToast]);

  // ── Backup ──────────────────────────────────────────────────────────────────

  const createBackup = useCallback(async () => {
    const ok = await confirm('Create a system backup? This may take a moment.', 'Create Backup');
    if (!ok) return;

    setBackupLoading(true);
    setBackupResult('');

    try {
      const res = await fetch('/api/backup/create', { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        setBackupResult(data.error || `HTTP ${res.status}`);
        setBackupLoading(false);
        return;
      }

      // Handle SSE response
      const reader = res.body?.getReader();
      if (!reader) { setBackupResult('No response body'); setBackupLoading(false); return; }

      const decoder = new TextDecoder();
      let buffer = '';
      let output = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'progress') output += evt.line + '\n';
            if (evt.type === 'done') {
              output += '\n✅ ' + (evt.message || 'Backup created');
              if (evt.path) {
                // Trigger download
                window.open(`/api/backup/download?path=${encodeURIComponent(evt.path)}`, '_blank');
              }
            }
          } catch { /* skip */ }
        }
      }

      setBackupResult(output || 'Backup completed');
      showToast('Backup created', 'success');
    } catch (e: unknown) {
      setBackupResult(e instanceof Error ? e.message : 'Unknown error');
    }
    setBackupLoading(false);
  }, [confirm, showToast]);

  const importBackup = useCallback(async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.zip')) {
      showToast('Please select a .zip file', 'error');
      input.value = '';
      return;
    }

    const ok = await confirm('Import backup? This will restore data from the backup file.', 'Import Backup');
    if (!ok) { input.value = ''; return; }

    setImportLoading(true);
    setBackupResult('');

    const formData = new FormData();
    formData.append('backup', file);

    try {
      const res = await fetch('/api/backup/import', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        setBackupResult(data.error || `HTTP ${res.status}`);
        setImportLoading(false);
        input.value = '';
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        const data = await res.json().catch(() => ({ message: 'Import completed' }));
        setBackupResult(data.message || 'Import completed');
        showToast('Backup imported successfully', 'success');
        setImportLoading(false);
        input.value = '';
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let output = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'progress') output += evt.line + '\n';
            if (evt.type === 'done') output += '\n✅ ' + (evt.message || 'Import completed');
          } catch { /* skip */ }
        }
      }

      setBackupResult(output || 'Import completed');
      showToast('Backup imported successfully', 'success');
    } catch (e: unknown) {
      setBackupResult(e instanceof Error ? e.message : 'Unknown error');
    }
    setImportLoading(false);
    input.value = '';
  }, [confirm, showToast]);

  // ── Render Helpers ──────────────────────────────────────────────────────────

  const renderDoctorOutput = (parsed: DoctorParsed) => {
    const { sections, totalPass, totalFail, totalWarn } = parsed;
    const total = totalPass + totalFail + totalWarn;
    if (!sections.length) return null;

    return (
      <div style={{ marginTop: '8px' }}>
        {/* Summary bar */}
        <div style={styles.doctorSummary}>
          <div style={{ ...styles.doctorSummaryItem, color: 'var(--success, #22c55e)' }}>
            <span>✓</span> {totalPass} passed
          </div>
          {totalWarn > 0 && (
            <div style={{ ...styles.doctorSummaryItem, color: 'var(--warning, #eab308)' }}>
              <span>⚠</span> {totalWarn} warnings
            </div>
          )}
          {totalFail > 0 && (
            <div style={{ ...styles.doctorSummaryItem, color: 'var(--danger, #ef4444)' }}>
              <span>✗</span> {totalFail} failed
            </div>
          )}
          <div style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--fg-muted)' }}>
            {total} checks
          </div>
        </div>

        {/* Sections */}
        {sections.map((sec, si) => {
          const hasFail = sec.items.some((i) => i.status === 'fail');
          const hasWarn = sec.items.some((i) => i.status === 'warn');
          const secStatus = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass';
          const secColor =
            secStatus === 'fail'
              ? 'var(--danger, #ef4444)'
              : secStatus === 'warn'
                ? 'var(--warning, #eab308)'
                : 'var(--success, #22c55e)';
          const secIcon = secStatus === 'fail' ? '✗' : secStatus === 'warn' ? '⚠' : '✓';

          return (
            <div key={si} style={styles.doctorSection}>
              <div style={styles.doctorSectionHeader}>
                <span style={{ color: secColor }}>{secIcon}</span>
                {sec.name}
              </div>
              {sec.items.map((item, ii) => (
                <div key={ii}>
                  <div style={styles.doctorItem}>
                    <span style={{
                      color:
                        item.status === 'pass'
                          ? 'var(--success, #22c55e)'
                          : item.status === 'fail'
                            ? 'var(--danger, #ef4444)'
                            : 'var(--warning, #eab308)',
                      flexShrink: 0,
                    }}>
                      {item.status === 'pass' ? '✓' : item.status === 'fail' ? '✗' : '⚠'}
                    </span>
                    <span style={styles.doctorItemText}>{item.text}</span>
                  </div>
                  {item.suggestion && (
                    <div style={styles.doctorSuggestion}>→ {item.suggestion}</div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Effects ─────────────────────────────────────────────────────────────────

  // Load initial data on mount
  useEffect(() => {
    loadHCIInfo();
    loadHermesVersion();
  }, [loadHCIInfo, loadHermesVersion]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      {/* Page Header */}
      <div style={styles.pageHeader}>
        <div>
          <div style={styles.pageTitle}>Maintenance</div>
          <div style={styles.pageSubtitle}>System maintenance, updates, backups, and diagnostics</div>
        </div>
      </div>

      {/* ===== Card Grid ===== */}
      <div style={styles.cardGrid}>
        {/* ── Health Check Card ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Health Check</div>
          {healthResults ? (
            <div style={{ flex: 1 }}>
              {healthResults.map((r, i) => (
                <div
                  key={i}
                  style={
                    i < healthResults.length - 1 ? styles.statRow : styles.statRowLast
                  }
                >
                  <span style={styles.statLabel}>{r.name}</span>
                  <span style={styles.statValue}>
                    <span style={r.ok ? styles.statusOk : styles.statusFail}>
                      {r.ok ? '● OK' : '○ FAIL'}
                    </span>{' '}
                    <span style={styles.latencyText}>{r.ms}ms</span>
                  </span>
                </div>
              ))}
              <div style={styles.allOk}>
                {healthResults.every((r) => r.ok)
                  ? 'All endpoints healthy'
                  : 'Some endpoints failed'}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: 'var(--fg-muted)', marginBottom: '8px', flex: 1 }}>
              Test all HCI API endpoints
            </div>
          )}
          <div style={styles.cardActions}>
            <button
              style={{ ...styles.btnGhost }}
              onClick={runHealthCheck}
              disabled={healthRunning}
            >
              {healthRunning ? 'Testing...' : 'Check APIs'}
            </button>
            <button
              style={{ ...styles.btnGhost }}
              onClick={restartHCI}
            >
              Restart HCI
            </button>
          </div>
        </div>

        {/* ── HCI Update Card ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>HCI Update</div>
          <div style={styles.versionGrid}>
            <div style={styles.statItem}>
              <span style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>Version</span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg)' }}>
                {hciInfo?.local?.version || '—'}
              </span>
            </div>
            <div style={styles.statItem}>
              <span style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>Commit</span>
              <code style={{ fontSize: '11px', color: 'var(--accent)' }}>
                {hciInfo?.local?.hash || '—'}
              </code>
            </div>
            <div style={styles.statItem}>
              <span style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>Branch</span>
              <code style={{ fontSize: '11px', color: 'var(--fg)' }}>
                {hciInfo?.branch || '—'}
              </code>
            </div>
            {(hciInfo?.behind ?? 0) > 0 && (
              <div style={styles.statItem}>
                <span style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>Behind</span>
                <span style={{ ...styles.badge, ...styles.badgeWarning }}>
                  {hciInfo?.behind}
                </span>
              </div>
            )}
          </div>
          <div style={styles.cardActions}>
            <button
              style={{ ...styles.btnPrimary, ...styles.btnSm }}
              onClick={checkHCIUpdates}
              disabled={hciLoading}
            >
              {hciLoading ? 'Checking...' : 'Check Updates'}
            </button>
            <button
              style={{ ...styles.btnOutline, ...styles.btnSm }}
              onClick={updateHCI}
            >
              Update All
            </button>
            <button
              style={{ ...styles.btnGhost, ...styles.btnSm }}
              onClick={rollbackHCI}
            >
              Rollback
            </button>
          </div>
        </div>

        {/* ── Doctor Card ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Doctor</div>
          {doctorRunning && (
            <div style={styles.loading}>Running diagnostics...</div>
          )}
          {doctorParsed && !doctorRunning && (
            <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
              {renderDoctorOutput(doctorParsed)}
            </div>
          )}
          {doctorResult && !doctorParsed && !doctorRunning && (
            <pre style={styles.preOutput}>{doctorResult}</pre>
          )}
          <div style={styles.cardActions}>
            <button
              style={{ ...styles.btnGhost }}
              onClick={runDoctor}
              disabled={doctorRunning}
            >
              {doctorRunning ? 'Running...' : 'Run Diagnose'}
            </button>
          </div>
        </div>

        {/* ── Dump Card ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Dump</div>
          <div style={{ fontSize: '12px', color: 'var(--fg-muted)', marginBottom: '8px', flex: 1 }}>
            Setup summary for debugging
          </div>
          {dumpLoading && <div style={styles.loading}>Generating dump...</div>}
          {dumpResult && !dumpLoading && (
            <pre style={styles.preOutput}>{dumpResult}</pre>
          )}
          <div style={styles.cardActions}>
            <button
              style={{ ...styles.btnGhost }}
              onClick={runDump}
              disabled={dumpLoading}
            >
              {dumpLoading ? 'Generating...' : 'Generate Dump'}
            </button>
          </div>
        </div>

        {/* ── Hermes Update Card ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Hermes Update</div>
          <div style={{
            ...styles.statRow,
            marginBottom: '8px',
            background: 'var(--bg-input)',
            padding: '8px 10px',
            borderRadius: 'var(--radius, 6px)',
            border: 'none',
          }}>
            <span style={styles.statLabel}>Version</span>
            <span style={styles.statValue}>{hermesVersion}</span>
          </div>
          {updateResult && (
            <pre style={{ ...styles.preOutput, maxHeight: '150px' }}>{updateResult}</pre>
          )}
          <div style={styles.cardActions}>
            <button
              style={{ ...styles.btnGhost }}
              onClick={updateHermes}
              disabled={updateRunning}
            >
              {updateRunning ? 'Updating...' : 'Update Hermes'}
            </button>
          </div>
        </div>

        {/* ── Backup Card ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Backup &amp; Import</div>
          <div style={{ fontSize: '12px', color: 'var(--fg-muted)', marginBottom: '10px', flex: 1 }}>
            Create and restore Hermes data backups
          </div>
          {backupResult && (
            <pre style={{ ...styles.preOutput, maxHeight: '150px' }}>{backupResult}</pre>
          )}
          <div style={styles.cardActions}>
            <button
              style={{ ...styles.btnGhost }}
              onClick={createBackup}
              disabled={backupLoading}
            >
              {backupLoading ? 'Creating...' : 'Create Backup'}
            </button>
            <label style={styles.fileLabel}>
              {importLoading ? 'Importing...' : 'Import'}
              <input
                type="file"
                accept=".zip"
                style={{ display: 'none' }}
                onChange={(e) => importBackup(e.target)}
                disabled={importLoading}
              />
            </label>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          MODALS
          ══════════════════════════════════════════════════════════════════ */}

      {/* Confirm Dialog */}
      {confirmDialog && (
        <div style={styles.modalOverlay} onClick={handleConfirmNo}>
          <div style={{ ...styles.modalCard, width: confirmDialog.message.startsWith('__COMMIT_LIST__') ? '600px' : '380px' }}>
            <div style={styles.modalTitle}>{confirmDialog.title}</div>

            {confirmDialog.message.startsWith('__COMMIT_LIST__') ? (
              /* Commit list modal */
              <div>
                {(() => {
                  const commits: HCIUpdateInfo['commits'] = JSON.parse(confirmDialog.message.slice('__COMMIT_LIST__'.length));
                  return (
                    <>
                      {commits.map((c) => (
                        <div key={c.hash} style={styles.commitCard}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <code style={styles.commitHash}>{c.shortHash}</code>
                            <span style={{ flex: 1, fontWeight: 600, fontSize: '13px', color: 'var(--fg)' }}>
                              {escapeHtml(c.msg)}
                            </span>
                            <button
                              style={{ ...styles.btnGhost, ...styles.btnSm }}
                              onClick={() => showCommitDiffModal(c.shortHash)}
                            >
                              Diff
                            </button>
                            <button
                              style={{ ...styles.btnPrimary, ...styles.btnSm }}
                              onClick={() => checkoutCommit(c.shortHash)}
                            >
                              Checkout
                            </button>
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>
                            {escapeHtml(c.author)} · {formatRelativeTime(c.date)}
                          </div>
                        </div>
                      ))}
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                        <button
                          style={{ ...styles.btnPrimary }}
                          onClick={() => { handleConfirmNo(); updateHCI(); }}
                        >
                          Update All (pull latest)
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : (
              <div style={styles.modalMessage}>{confirmDialog.message}</div>
            )}

            {!confirmDialog.message.startsWith('__COMMIT_LIST__') && (
              <div style={styles.modalActions}>
                <button style={styles.btnGhost} onClick={handleConfirmNo}>Cancel</button>
                <button style={styles.btnPrimary} onClick={handleConfirmYes}>Confirm</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Commit Diff Modal */}
      {diffModal && (
        <div style={styles.modalOverlay} onClick={() => setDiffModal(null)}>
          <div style={{ ...styles.modalCard, maxWidth: '700px' }}>
            <div style={styles.modalTitle}>
              {diffModal.commit.shortHash}: {diffModal.commit.msg}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--fg-muted)', marginBottom: '8px' }}>
              {diffModal.commit.author} · {formatRelativeTime(diffModal.commit.date)}
            </div>
            <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '8px' }}>
              {diffModal.shortstat}
            </div>
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {diffModal.files.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', padding: '2px 0' }}>
                  <span style={{ color: 'var(--success, #22c55e)' }}>+{f.added}</span>
                  <span style={{ color: 'var(--danger, #ef4444)' }}>-{f.removed}</span>
                  <span style={{
                    flex: 1,
                    fontFamily: 'var(--font-mono, monospace)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {f.file}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ ...styles.modalActions, marginTop: '16px' }}>
              <button style={styles.btnGhost} onClick={() => setDiffModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* SSE Progress Modal */}
      {sseModal && (
        <div style={styles.modalOverlay} onClick={() => sseModal.completed && setSseModal(null)}>
          <div style={{ ...styles.modalCard, maxWidth: '600px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ ...styles.modalTitle, marginBottom: 0 }}>{sseModal.title}</div>
              {sseModal.completed && (
                <button
                  style={{ ...styles.btnGhost, ...styles.btnSm }}
                  onClick={() => setSseModal(null)}
                >
                  Close
                </button>
              )}
            </div>
            <pre style={styles.sseLog}>
              {sseModal.log || 'Starting...'}
            </pre>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          ...styles.toastBase,
          background: toast.type === 'success' ? 'var(--success, #22c55e)' : toast.type === 'error' ? 'var(--danger, #ef4444)' : 'var(--accent)',
          color: '#fff',
        }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
