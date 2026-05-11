'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '@/app/lib/api-client';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import {
  RiRefreshLine,
  RiDownloadLine,
  RiHistoryLine,
  RiStethoscopeLine,
  RiFileCopyLine,
  RiUploadLine,
  RiArrowUpSLine,
  RiCloseLine,
  RiCheckLine,
  RiArrowRightLine,
} from '@remixicon/react';

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
  const [commitListData, setCommitListData] = useState<HCIUpdateInfo | null>(null);
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
    setSseModal(null);
    setCommitListData(data);
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
    setCommitListData(null);
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
      <div className="mt-2">
        {/* Summary bar */}
        <div className="flex flex-wrap gap-2 items-center px-2.5 py-2 bg-muted rounded-md mb-2 text-xs">
          <div className="flex items-center gap-1 font-semibold text-green-500">
            <span>✓</span> {totalPass} passed
          </div>
          {totalWarn > 0 && (
            <div className="flex items-center gap-1 font-semibold text-yellow-500">
              <span>⚠</span> {totalWarn} warnings
            </div>
          )}
          {totalFail > 0 && (
            <div className="flex items-center gap-1 font-semibold text-red-500">
              <span>✗</span> {totalFail} failed
            </div>
          )}
          <div className="ml-auto text-[11px] text-muted-foreground">
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
              ? 'text-red-500'
              : secStatus === 'warn'
                ? 'text-yellow-500'
                : 'text-green-500';
          const secIcon = secStatus === 'fail' ? '✗' : secStatus === 'warn' ? '⚠' : '✓';

          return (
            <div key={si} className="mb-1.5">
              <div className="text-xs font-semibold flex items-center gap-1.5 py-1">
                <span className={secColor}>{secIcon}</span>
                {sec.name}
              </div>
              {sec.items.map((item, ii) => (
                <div key={ii}>
                  <div className="flex items-start gap-1.5 py-0.5 pl-3 text-[11px]">
                    <span
                      className={`shrink-0 ${
                        item.status === 'pass'
                          ? 'text-green-500'
                          : item.status === 'fail'
                            ? 'text-red-500'
                            : 'text-yellow-500'
                      }`}
                    >
                      {item.status === 'pass' ? '✓' : item.status === 'fail' ? '✗' : '⚠'}
                    </span>
                    <span className="text-muted-foreground flex-1">{item.text}</span>
                  </div>
                  {item.suggestion && (
                    <div className="text-[11px] italic text-muted-foreground/70 pl-[30px] pb-1">
                      → {item.suggestion}
                    </div>
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
    <div className="h-full overflow-y-auto p-6">
      {/* Page Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <h1 className="text-xl font-bold tracking-wider uppercase">Maintenance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            System maintenance, updates, backups, and diagnostics
          </p>
        </div>
      </div>

      {/* ===== Card Grid ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* ── Health Check Card ── */}
        <Card>
          <CardHeader>
            <CardTitle>Health Check</CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            {healthResults ? (
              <div>
                {healthResults.map((r, i) => (
                  <div
                    key={i}
                    className={`flex justify-between items-center py-1 ${
                      i < healthResults.length - 1 ? 'border-b border-border' : ''
                    }`}
                  >
                    <span className="text-xs text-muted-foreground">{r.name}</span>
                    <span className="text-xs font-medium text-right">
                      <span className={r.ok ? 'text-green-500' : 'text-red-500'}>
                        {r.ok ? '● OK' : '○ FAIL'}
                      </span>{' '}
                      <span className="text-[10px] opacity-60">{r.ms}ms</span>
                    </span>
                  </div>
                ))}
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {healthResults.every((r) => r.ok)
                    ? 'All endpoints healthy'
                    : 'Some endpoints failed'}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground mb-2">
                Test all HCI API endpoints
              </div>
            )}
          </CardContent>
          <CardFooter className="gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={runHealthCheck}
              disabled={healthRunning}
            >
              <RiStethoscopeLine />
              {healthRunning ? 'Testing...' : 'Check APIs'}
            </Button>
            <Button variant="outline" size="sm" onClick={restartHCI}>
              <RiRefreshLine />
              Restart HCI
            </Button>
          </CardFooter>
        </Card>

        {/* ── HCI Update Card ── */}
        <Card>
          <CardHeader>
            <CardTitle>HCI Update</CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="flex flex-wrap gap-3 mb-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">Version</span>
                <span className="text-xs font-semibold">
                  {hciInfo?.local?.version || '—'}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">Commit</span>
                <code className="text-[11px] text-primary">
                  {hciInfo?.local?.hash || '—'}
                </code>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">Branch</span>
                <code className="text-[11px]">
                  {hciInfo?.branch || '—'}
                </code>
              </div>
              {(hciInfo?.behind ?? 0) > 0 && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted-foreground">Behind</span>
                  <Badge
                    variant="outline"
                    className="bg-yellow-500/10 text-yellow-500 border-yellow-500"
                  >
                    {hciInfo?.behind}
                  </Badge>
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter className="gap-2 flex-wrap">
            <Button
              variant="default"
              size="sm"
              onClick={checkHCIUpdates}
              disabled={hciLoading}
            >
              <RiRefreshLine />
              {hciLoading ? 'Checking...' : 'Check Updates'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-primary text-primary hover:bg-primary/10"
              onClick={updateHCI}
            >
              <RiDownloadLine />
              Update All
            </Button>
            <Button variant="outline" size="sm" onClick={rollbackHCI}>
              <RiHistoryLine />
              Rollback
            </Button>
          </CardFooter>
        </Card>

        {/* ── Doctor Card ── */}
        <Card>
          <CardHeader>
            <CardTitle>Doctor</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            {doctorRunning && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground italic py-2">
                <Spinner className="size-3" />
                Running diagnostics...
              </div>
            )}
            {doctorParsed && !doctorRunning && (
              <ScrollArea className="max-h-[500px]">
                {renderDoctorOutput(doctorParsed)}
              </ScrollArea>
            )}
            {doctorResult && !doctorParsed && !doctorRunning && (
              <pre className="text-[10px] whitespace-pre-wrap max-h-[300px] overflow-y-auto text-muted-foreground font-mono bg-muted p-2 rounded-md">
                {doctorResult}
              </pre>
            )}
          </CardContent>
          <CardFooter className="gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={runDoctor}
              disabled={doctorRunning}
            >
              <RiStethoscopeLine />
              {doctorRunning ? 'Running...' : 'Run Diagnose'}
            </Button>
          </CardFooter>
        </Card>

        {/* ── Dump Card ── */}
        <Card>
          <CardHeader>
            <CardTitle>Dump</CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="text-xs text-muted-foreground mb-2">
              Setup summary for debugging
            </div>
            {dumpLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground italic py-2">
                <Spinner className="size-3" />
                Generating dump...
              </div>
            )}
            {dumpResult && !dumpLoading && (
              <pre className="text-[10px] whitespace-pre-wrap max-h-[300px] overflow-y-auto text-muted-foreground font-mono bg-muted p-2 rounded-md">
                {dumpResult}
              </pre>
            )}
          </CardContent>
          <CardFooter className="gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={runDump}
              disabled={dumpLoading}
            >
              <RiFileCopyLine />
              {dumpLoading ? 'Generating...' : 'Generate Dump'}
            </Button>
          </CardFooter>
        </Card>

        {/* ── Hermes Update Card ── */}
        <Card>
          <CardHeader>
            <CardTitle>Hermes Update</CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="flex justify-between items-center py-2 px-2.5 bg-muted rounded-md mb-2">
              <span className="text-xs text-muted-foreground">Version</span>
              <span className="text-xs font-medium">{hermesVersion}</span>
            </div>
            {updateResult && (
              <pre className="text-[10px] whitespace-pre-wrap max-h-[150px] overflow-y-auto text-muted-foreground font-mono bg-muted p-2 rounded-md">
                {updateResult}
              </pre>
            )}
          </CardContent>
          <CardFooter className="gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={updateHermes}
              disabled={updateRunning}
            >
              <RiArrowUpSLine />
              {updateRunning ? 'Updating...' : 'Update Hermes'}
            </Button>
          </CardFooter>
        </Card>

        {/* ── Backup Card ── */}
        <Card>
          <CardHeader>
            <CardTitle>Backup &amp; Import</CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="text-xs text-muted-foreground mb-2.5">
              Create and restore Hermes data backups
            </div>
            {backupResult && (
              <pre className="text-[10px] whitespace-pre-wrap max-h-[150px] overflow-y-auto text-muted-foreground font-mono bg-muted p-2 rounded-md">
                {backupResult}
              </pre>
            )}
          </CardContent>
          <CardFooter className="gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={createBackup}
              disabled={backupLoading}
            >
              <RiUploadLine />
              {backupLoading ? 'Creating...' : 'Create Backup'}
            </Button>
            <label className="inline-flex items-center justify-center gap-1.5 h-6 px-2 text-xs font-medium rounded-md border border-border bg-background cursor-pointer transition-all whitespace-nowrap hover:bg-muted">
              <RiDownloadLine className="size-3" />
              {importLoading ? 'Importing...' : 'Import'}
              <input
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => importBackup(e.target)}
                disabled={importLoading}
              />
            </label>
          </CardFooter>
        </Card>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          MODALS
          ══════════════════════════════════════════════════════════════════ */}

      {/* Confirm Dialog */}
      <Dialog
        open={confirmDialog !== null}
        onOpenChange={(open) => {
          if (!open) handleConfirmNo();
        }}
      >
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>{confirmDialog?.title}</DialogTitle>
          </DialogHeader>
          <p className="text-xs/relaxed text-muted-foreground whitespace-pre-wrap">
            {confirmDialog?.message}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={handleConfirmNo}>
              <RiCloseLine />
              Cancel
            </Button>
            <Button onClick={handleConfirmYes}>
              <RiCheckLine />
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Commit List Dialog */}
      <Dialog
        open={commitListData !== null}
        onOpenChange={(open) => {
          if (!open) setCommitListData(null);
        }}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {commitListData && `${commitListData.behind} commit(s) behind on ${commitListData.branch}`}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            {commitListData && (
              <div>
                {commitListData.commits.map((c) => (
                  <div
                    key={c.hash}
                    className="p-2.5 border border-border rounded-md mb-1.5 bg-muted"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <code className="font-mono text-[11px] text-primary mr-2">
                        {c.shortHash}
                      </code>
                      <span className="flex-1 font-semibold text-sm">
                        {escapeHtml(c.msg)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => showCommitDiffModal(c.shortHash)}
                      >
                        <RiFileCopyLine />
                        Diff
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => checkoutCommit(c.shortHash)}
                      >
                        <RiArrowRightLine />
                        Checkout
                      </Button>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {escapeHtml(c.author)} · {formatRelativeTime(c.date)}
                    </div>
                  </div>
                ))}
                <div className="mt-3 pt-3 border-t border-border">
                  <Button
                    onClick={() => {
                      setCommitListData(null);
                      updateHCI();
                    }}
                  >
                    <RiDownloadLine />
                    Update All (pull latest)
                  </Button>
                </div>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Commit Diff Dialog */}
      <Dialog
        open={diffModal !== null}
        onOpenChange={(open) => {
          if (!open) setDiffModal(null);
        }}
      >
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>
              {diffModal && `${diffModal.commit.shortHash}: ${diffModal.commit.msg}`}
            </DialogTitle>
          </DialogHeader>
          {diffModal && (
            <>
              <div className="text-xs text-muted-foreground mb-2">
                {diffModal.commit.author} · {formatRelativeTime(diffModal.commit.date)}
              </div>
              <div className="font-semibold text-xs mb-2">{diffModal.shortstat}</div>
              <ScrollArea className="max-h-[400px]">
                {diffModal.files.map((f, i) => (
                  <div key={i} className="flex gap-2 text-xs py-0.5">
                    <span className="text-green-500">+{f.added}</span>
                    <span className="text-red-500">-{f.removed}</span>
                    <span className="flex-1 font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                      {f.file}
                    </span>
                  </div>
                ))}
              </ScrollArea>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiffModal(null)}>
              <RiCloseLine />
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SSE Progress Dialog */}
      <Dialog
        open={sseModal !== null}
        onOpenChange={(open) => {
          if (!open && sseModal?.completed) setSseModal(null);
        }}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader className="flex flex-row justify-between items-center w-full">
            <DialogTitle>{sseModal?.title}</DialogTitle>
            {sseModal?.completed && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSseModal(null)}
              >
                <RiCloseLine />
                Close
              </Button>
            )}
          </DialogHeader>
          <pre className="font-mono text-xs leading-relaxed max-h-[400px] overflow-y-auto bg-muted p-3 rounded-md whitespace-pre-wrap text-muted-foreground">
            {sseModal?.log || 'Starting...'}
          </pre>
        </DialogContent>
      </Dialog>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-5 py-2.5 rounded-md text-sm font-medium z-[1000] text-white ${
            toast.type === 'success'
              ? 'bg-green-500'
              : toast.type === 'error'
                ? 'bg-red-500'
                : 'bg-primary'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
