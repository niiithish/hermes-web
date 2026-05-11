'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from '@/app/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Empty, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import {
  RiRefreshLine,
  RiFileCopyLine,
  RiCheckLine,
  RiCloseLine,
  RiArrowDownLine,
} from '@remixicon/react';

// ============================================
// Constants (mirrored from main.js)
// ============================================

const LEVEL_MAP: Record<string, string> = {
  info: 'INF',
  debug: 'DBG',
  error: 'ERR',
  warn: 'WRN',
  system: 'SYS',
  user: 'USR',
};

const LEVEL_COLOR_CLASSES: Record<string, string> = {
  INF: 'text-muted-foreground',
  DBG: 'text-muted-foreground/50',
  ERR: 'text-red-500 dark:text-red-400',
  WRN: 'text-amber-500 dark:text-amber-400',
  SYS: 'text-teal-400 dark:text-teal-300',
  USR: 'text-purple-400 dark:text-purple-300',
};

const TYPE_OPTIONS = [
  { value: '', label: 'ALL', color: undefined as string | undefined },
  { value: 'QC', label: 'QC', color: 'text-purple-400' },
  { value: 'ALERT', label: 'ALERT', color: 'text-red-500' },
  { value: 'TASK', label: 'TASK', color: 'text-teal-400' },
  { value: 'TOOL', label: 'TOOL', color: 'text-blue-400' },
  { value: 'MCP', label: 'MCP', color: 'text-orange-400' },
] as const;

const TYPE_COLOR_CLASSES: Record<string, string> = {
  QC: 'text-purple-400',
  ALERT: 'text-red-500',
  TASK: 'text-teal-400',
  TOOL: 'text-blue-400',
  MCP: 'text-orange-400',
};

const TYPE_BG_CLASSES: Record<string, string> = {
  QC: 'bg-purple-400/15',
  ALERT: 'bg-red-500/15',
  TASK: 'bg-teal-400/15',
  TOOL: 'bg-blue-400/15',
  MCP: 'bg-orange-400/15',
};

const TYPE_KEYWORDS: Record<string, string[]> = {
  QC: ['quality', 'score', 'eval'],
  ALERT: ['alert', 'warning', 'critical', 'threshold'],
  TASK: ['task', 'job', 'running', 'completed'],
  TOOL: ['tool', 'function', 'call'],
  MCP: ['mcp', 'mcp-server', 'stdio'],
};

const LEVEL_OPTIONS = [
  { value: '', label: 'ALL' },
  { value: 'info', label: 'INF' },
  { value: 'debug', label: 'DBG' },
  { value: 'warn', label: 'WRN' },
  { value: 'error', label: 'ERR' },
] as const;

const SOURCE_OPTIONS = [
  { value: 'all', label: 'all' },
  { value: 'agent', label: 'agent' },
  { value: 'error', label: 'errors' },
  { value: 'gateway', label: 'gateway' },
] as const;

const LINES_OPTIONS = ['50', '100', '200', '500'] as const;

// ============================================
// Helpers
// ============================================

function detectLogType(message: string | undefined): string | null {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return type;
  }
  return null;
}

function fmtLogTime(ts: string | undefined): string {
  if (!ts) return '        ';
  const d = new Date(ts);
  if (isNaN(d.getTime())) {
    const m = ts.match(/(\d{2}):(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}:${m[3]}` : ts.slice(-8);
  }
  return d.toTimeString().slice(0, 8);
}

// ============================================
// Types
// ============================================

interface LogEntry {
  timestamp?: string;
  level?: string;
  message?: string;
  component?: string;
  source?: string;
}

interface AggregatedEntry extends LogEntry {
  count: number;
}

interface LogsResponse {
  ok: boolean;
  logs?: LogEntry[];
  error?: string;
}

// ============================================
// LogsPage Component
// ============================================

export default function LogsPage() {
  // --- State ---
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');

  // Filters
  const [source, setSource] = useState('all');
  const [level, setLevel] = useState('');
  const [type, setType] = useState('');
  const [lines, setLines] = useState('100');
  const [search, setSearch] = useState('');
  const [component, setComponent] = useState('');

  // UI state
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [mode, setMode] = useState<'poll' | 'stream'>('poll');
  const [stickyBottom, setStickyBottom] = useState(true);

  // Refs
  const panelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derived toggle-group values as string[]
  const levelToggleValue: string[] = level ? [level] : [];
  const typeToggleValue: string[] = type ? [type] : [];

  // --- Fetch logs ---
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setFetchError('');
    try {
      const params = new URLSearchParams({ profile: 'all', source, lines });
      if (level) params.set('level', level);
      if (search) params.set('search', search);

      const data = await api.get<LogsResponse>(`/api/logs?${params}`);

      if (data.ok && data.logs) {
        let result = data.logs;

        // Client-side component filter
        if (component) {
          result = result.filter(
            (l) => (l.component || '').toLowerCase() === component.toLowerCase(),
          );
        }

        // Client-side type filter
        if (type) {
          result = result.filter((l) => detectLogType(l.message) === type);
        }

        setLogs(result);
      } else if (!data.ok && (data as any).error) {
        setFetchError((data as any).error);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [source, lines, level, search, component, type]);

  // --- Debounced search ---
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchLogs();
      }, 400);
    },
    [fetchLogs],
  );

  // --- Auto-refresh ---
  useEffect(() => {
    if (autoRefresh) {
      const intervalMs = mode === 'stream' ? 2000 : 5000;
      intervalRef.current = setInterval(() => {
        fetchLogs();
      }, intervalMs);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, mode, fetchLogs]);

  // --- Initial load + refetch on filter changes (except search, handled by debounce) ---
  useEffect(() => {
    fetchLogs();
  }, [source, lines, level, component, type, fetchLogs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // --- Scroll handling ---
  const handleScroll = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const atBottom =
      panel.scrollHeight - panel.scrollTop - panel.clientHeight < 40;
    setStickyBottom(atBottom);
  }, []);

  // Scroll to bottom when logs update and stickyBottom is true
  useEffect(() => {
    if (stickyBottom && panelRef.current) {
      requestAnimationFrame(() => {
        if (panelRef.current) {
          panelRef.current.scrollTop = panelRef.current.scrollHeight;
        }
      });
    }
  }, [logs, stickyBottom]);

  // --- Actions ---
  const scrollToBottom = useCallback(() => {
    const panel = panelRef.current;
    if (panel) {
      panel.scrollTop = panel.scrollHeight;
      setStickyBottom(true);
    }
  }, []);

  const copyLogLine = useCallback(async (lineEl: HTMLElement | null) => {
    if (!lineEl) return;
    const text = Array.from(lineEl.childNodes)
      .map((n) => n.textContent || '')
      .join('')
      .replace('\u29C9', '')
      .trim();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard write failed
    }
  }, []);

  // --- Derived: aggregated logs ---
  const aggregated = useMemo(() => {
    if (!logs.length) return [];

    // Aggregate consecutive duplicate entries (level + message) — oldest first
    const items: AggregatedEntry[] = [];
    let prevKey = '';
    let count = 0;

    for (let i = logs.length - 1; i >= 0; i--) {
      const e = logs[i];
      const key = `${e.level}|${e.message}`;
      if (key === prevKey) {
        count++;
      } else {
        if (prevKey && count > 1) {
          items[items.length - 1].count = count;
        }
        items.push({ ...e, count: 1 });
        prevKey = key;
        count = 1;
      }
    }
    if (count > 1 && items.length > 0) {
      items[items.length - 1].count = count;
    }

    // Reverse to show newest first
    return items.reverse();
  }, [logs]);

  // --- Derived: stats ---
  const stats = useMemo(() => {
    const lvlCounts: Record<string, number> = {
      INF: 0, DBG: 0, ERR: 0, WRN: 0, SYS: 0, USR: 0,
    };
    const typeCounts: Record<string, number> = {};
    const componentSet = new Set<string>();

    logs.forEach((e) => {
      const s = LEVEL_MAP[e.level || ''] || 'INF';
      lvlCounts[s] = (lvlCounts[s] || 0) + 1;

      const t = detectLogType(e.message);
      if (t) typeCounts[t] = (typeCounts[t] || 0) + 1;

      if (e.component) componentSet.add(e.component);
    });

    return { lvlCounts, typeCounts, componentCount: componentSet.size, total: logs.length };
  }, [logs]);

  // --- Derived: type badge info for each entry ---
  const typeInfoMap = useMemo(() => {
    const map = new Map<string, { type: string; colorClass: string } | null>();
    const cacheKey = (m: string | undefined) => m || '';
    aggregated.forEach((e) => {
      const key = cacheKey(e.message);
      if (!map.has(key)) {
        const entryType = detectLogType(e.message);
        if (entryType) {
          map.set(key, {
            type: entryType,
            colorClass: TYPE_COLOR_CLASSES[entryType] || 'text-muted-foreground',
          });
        } else {
          map.set(key, null);
        }
      }
    });
    return map;
  }, [aggregated]);

  // --- Derived: auto-refresh button label ---
  const autoLabel = autoRefresh ? '\u25CF auto' : '\u25CB auto';

  // ============================================
  // Render
  // ============================================
  return (
    <div className="flex flex-col h-full overflow-hidden p-3">
      {/* ===== Filter Bar ===== */}
      <div className="flex items-center gap-2.5 flex-wrap py-2 border-b border-border mb-2 min-h-10">
        {/* Source dropdown */}
        <Select value={source} onValueChange={(v) => setSource(v ?? 'all')}>
          <SelectTrigger size="sm" className="w-fit min-w-[80px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Level toggle buttons */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground">Level:</span>
          <ToggleGroup
            value={levelToggleValue}
            onValueChange={(vals) => setLevel(vals.length > 0 ? vals[vals.length - 1] : '')}
            variant="outline"
            size="sm"
            spacing={0}
          >
            {LEVEL_OPTIONS.filter((o) => o.value !== '').map((opt) => (
              <ToggleGroupItem key={opt.value} value={opt.value}>
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {/* Type toggle buttons */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground">Type:</span>
          <ToggleGroup
            value={typeToggleValue}
            onValueChange={(vals) => setType(vals.length > 0 ? vals[vals.length - 1] : '')}
            variant="outline"
            size="sm"
            spacing={0}
          >
            {TYPE_OPTIONS.filter((o) => o.value !== '').map((opt) => (
              <ToggleGroupItem key={opt.value} value={opt.value}>
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {/* Lines dropdown */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground">Lines:</span>
          <Select value={lines} onValueChange={(v) => setLines(v ?? '100')}>
            <SelectTrigger size="sm" className="w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LINES_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Search input */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground">Search:</span>
          <Input
            type="text"
            placeholder="keyword..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-[140px] h-6 text-xs font-mono"
          />
        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-1.5 ml-auto">
          {/* Auto-refresh toggle */}
          <Button
            variant={autoRefresh ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => {
              setAutoRefresh((prev) => !prev);
            }}
            title="Toggle auto-refresh"
          >
            {autoLabel}
          </Button>

          {/* Mode toggle */}
          <Select value={mode} onValueChange={(v) => setMode(v as 'poll' | 'stream')}>
            <SelectTrigger size="sm" className="w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="poll">poll</SelectItem>
              <SelectItem value="stream">stream</SelectItem>
            </SelectContent>
          </Select>

          {/* Clear button */}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setLogs([]);
            }}
          >
            <RiCloseLine className="size-3" />
            Clear
          </Button>

          {/* Refresh button */}
          <Button variant="ghost" size="icon-xs" onClick={fetchLogs} title="Refresh">
            <RiRefreshLine className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* ===== Component filter bar ===== */}
      {component && (
        <div className="flex items-center gap-1.5 mb-1.5 px-2 py-1 rounded-md bg-muted/50 text-[11px]">
          <span className="text-muted-foreground">Filtering:</span>
          <span className="text-teal-400 font-semibold">
            {component}
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="h-4 px-1 text-[10px]"
            onClick={() => setComponent('')}
          >
            <RiCloseLine className="size-2.5" />
          </Button>
        </div>
      )}

      {/* ===== Log Panel ===== */}
      <div
        ref={panelRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-xs leading-relaxed relative"
      >
        {aggregated.length === 0 ? (
          <Empty className="mt-10">
            {loading ? (
              <>
                <Spinner className="size-5 mb-2" />
                <EmptyTitle>Loading logs...</EmptyTitle>
              </>
            ) : fetchError ? (
              <>
                <EmptyTitle className="text-destructive">Error</EmptyTitle>
                <EmptyDescription>{fetchError}</EmptyDescription>
              </>
            ) : (
              <EmptyTitle>No log entries</EmptyTitle>
            )}
          </Empty>
        ) : (
          aggregated.map((entry, idx) => {
            const shortLvl = LEVEL_MAP[entry.level || ''] || 'INF';
            const time = fmtLogTime(entry.timestamp);
            const comp = entry.component || entry.source || '';
            const msg = entry.message || '';
            const typeInfo =
              typeInfoMap.get(entry.message || '') ?? null;

            return (
              <LogLine
                key={`${time}-${entry.level}-${idx}`}
                shortLvl={shortLvl}
                time={time}
                entryType={typeInfo}
                component={comp}
                message={msg}
                count={entry.count}
                onComponentClick={() => setComponent(comp)}
                onTypeClick={() =>
                  typeInfo && setType(type === typeInfo.type ? '' : typeInfo.type)
                }
                onCopy={copyLogLine}
              />
            );
          })
        )}
      </div>

      {/* ===== Jump-to-bottom button ===== */}
      {!stickyBottom && logs.length > 0 && (
        <Button
          size="xs"
          onClick={scrollToBottom}
          className="fixed bottom-20 right-6 z-50 shadow-lg"
        >
          <RiArrowDownLine className="size-3.5" />
          New logs
        </Button>
      )}

      {/* ===== Stats Bar ===== */}
      <div className="flex items-center gap-3 py-1.5 text-[11px] text-muted-foreground border-t border-border mt-2 flex-wrap">
        <span>{stats.total} entries</span>

        {Object.entries(stats.lvlCounts).map(([lvl, count]) =>
          count > 0 ? (
            <span key={lvl} className={LEVEL_COLOR_CLASSES[lvl] || 'text-muted-foreground'}>
              {lvl} {count}
            </span>
          ) : null,
        )}

        {Object.entries(stats.typeCounts).map(([t, c]) => (
          <span
            key={t}
            className={`${TYPE_COLOR_CLASSES[t] || 'text-muted-foreground'} ml-1.5`}
          >
            {t} {c}
          </span>
        ))}

        {stats.componentCount > 0 && (
          <span className="ml-auto text-muted-foreground/60">
            {stats.componentCount} components
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================
// LogLine sub-component
// ============================================

function LogLine({
  shortLvl,
  time,
  entryType,
  component,
  message,
  count,
  onComponentClick,
  onTypeClick,
  onCopy,
}: {
  shortLvl: string;
  time: string;
  entryType: { type: string; colorClass: string } | null;
  component: string;
  message: string;
  count: number;
  onComponentClick: () => void;
  onTypeClick: () => void;
  onCopy: (el: HTMLElement | null) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const lineRef = useRef<HTMLDivElement>(null);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCopied(true);
    onCopy(lineRef.current);
    setTimeout(() => setCopied(false), 1000);
  };

  const lineBg =
    shortLvl === 'ERR'
      ? 'bg-red-500/5'
      : shortLvl === 'WRN'
        ? 'bg-amber-500/5'
        : '';

  return (
    <div
      ref={lineRef}
      className={`flex items-baseline px-1 py-px rounded-sm cursor-default ${lineBg}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Timestamp */}
      <span className="text-muted-foreground select-none min-w-[70px] shrink-0">
        [{time}]
      </span>

      {/* Level badge */}
      <span
        className={`min-w-[32px] text-center font-semibold select-none shrink-0 ${LEVEL_COLOR_CLASSES[shortLvl] || 'text-muted-foreground'}`}
      >
        {shortLvl}
      </span>

      {/* Type badge (clickable) */}
      {entryType && (
        <span
          className={`font-semibold text-[10px] tracking-wider px-1 py-0 rounded-sm ml-1 cursor-pointer shrink-0 ${entryType.colorClass} ${TYPE_BG_CLASSES[entryType.type] || ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onTypeClick();
          }}
          title={`Filter by ${entryType.type}`}
        >
          {entryType.type}
        </span>
      )}

      {/* Component tag (clickable) */}
      {component ? (
        <span
          className="cursor-pointer text-teal-400 no-underline mr-1 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onComponentClick();
          }}
          title={`Filter by ${component}`}
        >
          {component}
        </span>
      ) : (
        <span className="min-w-[40px] shrink-0" />
      )}

      {/* Message + duplicate count */}
      <span className="flex-1 break-all">
        {message}
        {count > 1 && (
          <span className="text-red-400 font-bold ml-1 shrink-0">
            &times;{count}
          </span>
        )}
      </span>

      {/* Copy icon */}
      <span
        className={`cursor-pointer text-muted-foreground ml-1.5 shrink-0 select-none transition-opacity duration-150 ${hovered || copied ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleCopy}
        title="Copy"
      >
        {copied ? (
          <RiCheckLine className="size-3 inline" />
        ) : (
          <RiFileCopyLine className="size-3 inline" />
        )}
      </span>
    </div>
  );
}
