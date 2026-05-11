'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from '@/app/lib/api-client';

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

const LEVEL_COLORS: Record<string, string> = {
  INF: 'var(--fg-muted)',
  DBG: 'var(--fg-subtle)',
  ERR: 'var(--red, #c45c5c)',
  WRN: 'var(--amber, #c4a44c)',
  SYS: 'var(--teal, #4ecdc4)',
  USR: 'var(--purple, #a78bfa)',
};

const TYPE_OPTIONS = [
  { value: '', label: 'ALL', color: undefined as string | undefined },
  { value: 'QC', label: 'QC', color: '#a78bfa' },
  { value: 'ALERT', label: 'ALERT', color: '#ff6b6b' },
  { value: 'TASK', label: 'TASK', color: '#4ecdc4' },
  { value: 'TOOL', label: 'TOOL', color: '#60a5fa' },
  { value: 'MCP', label: 'MCP', color: '#fb923c' },
] as const;

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
// Styles (inline custom properties)
// ============================================

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    padding: '12px 16px',
    overflow: 'hidden',
  } as React.CSSProperties,

  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap' as const,
    padding: '8px 0',
    borderBottom: '1px solid var(--border)',
    marginBottom: '8px',
    minHeight: '40px',
  } as React.CSSProperties,

  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  } as React.CSSProperties,

  filterLabel: {
    fontSize: '11px',
    color: 'var(--fg-muted)',
  } as React.CSSProperties,

  select: {
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius, 6px)',
    color: 'var(--fg)',
    fontFamily: 'var(--font, monospace)',
    fontSize: '12px',
    padding: '4px 8px',
    outline: 'none',
    cursor: 'pointer',
  } as React.CSSProperties,

  searchInput: {
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius, 6px)',
    color: 'var(--fg)',
    fontFamily: 'var(--font, monospace)',
    fontSize: '12px',
    padding: '4px 8px',
    outline: 'none',
    width: '140px',
  } as React.CSSProperties,

  toggleBtn: (active: boolean, color?: string): React.CSSProperties => ({
    padding: '3px 8px',
    fontSize: '11px',
    fontFamily: 'var(--font, monospace)',
    fontWeight: 600,
    background: active ? 'var(--bg-panel-hover)' : 'var(--bg-panel)',
    color: active ? (color || 'var(--fg)') : 'var(--fg-muted)',
    border: `1px solid ${active ? 'var(--border-strong)' : 'var(--border)'}`,
    borderRadius: 'var(--radius, 6px)',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
    whiteSpace: 'nowrap' as const,
  }),

  iconBtn: (active?: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 10px',
    fontSize: '13px',
    fontFamily: 'var(--font, monospace)',
    background: active ? 'var(--bg-panel-hover)' : 'var(--bg-panel)',
    color: active ? 'var(--accent)' : 'var(--fg)',
    border: `1px solid ${active ? 'var(--border-strong)' : 'var(--border)'}`,
    borderRadius: 'var(--radius, 6px)',
    cursor: 'pointer',
    transition: 'background 0.15s',
    whiteSpace: 'nowrap' as const,
  }),

  componentBar: {
    display: 'flex' as const,
    alignItems: 'center',
    gap: '6px',
    marginBottom: '6px',
    padding: '4px 8px',
    background: 'var(--bg-inset, var(--bg-input))',
    borderRadius: 'var(--radius, 6px)',
    fontSize: '11px',
  },

  logPanel: {
    flex: 1,
    overflowY: 'auto' as const,
    fontFamily: 'var(--font-mono, var(--font, monospace))',
    fontSize: '12px',
    lineHeight: '1.7',
    position: 'relative' as const,
  },

  logLine: (shortLvl: string): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'baseline',
    padding: '1px 4px',
    borderRadius: '3px',
    backgroundColor:
      shortLvl === 'ERR'
        ? 'rgba(255,107,107,0.06)'
        : shortLvl === 'WRN'
          ? 'rgba(255,172,2,0.04)'
          : 'transparent',
  }),

  logTimestamp: {
    color: 'var(--fg-subtle)',
    userSelect: 'none' as const,
    minWidth: '70px',
    flexShrink: 0,
  } as React.CSSProperties,

  logLevel: (shortLvl: string): React.CSSProperties => ({
    color: LEVEL_COLORS[shortLvl] || 'var(--fg-muted)',
    minWidth: '32px',
    textAlign: 'center' as const,
    fontWeight: 600,
    userSelect: 'none' as const,
    flexShrink: 0,
  }),

  logMessage: {
    flex: 1,
    wordBreak: 'break-all' as const,
  } as React.CSSProperties,

  duplicateBadge: {
    color: 'var(--coral, #ff6b6b)',
    fontWeight: 700,
    marginLeft: '4px',
    flexShrink: 0,
  } as React.CSSProperties,

  copyIcon: {
    cursor: 'pointer',
    opacity: 0,
    color: 'var(--fg-muted)',
    marginLeft: '6px',
    transition: 'opacity 0.15s',
    flexShrink: 0,
    userSelect: 'none' as const,
  } as React.CSSProperties,

  copyIconVisible: {
    opacity: 1,
  } as React.CSSProperties,

  componentTag: {
    cursor: 'pointer',
    color: 'var(--teal, #4ecdc4)',
    textDecoration: 'none' as const,
    marginRight: '4px',
    flexShrink: 0,
  } as React.CSSProperties,

  typeBadge: (color: string): React.CSSProperties => ({
    color,
    fontWeight: 600,
    fontSize: '10px',
    letterSpacing: '0.3px',
    background: `${color}18`,
    padding: '0 4px',
    borderRadius: '3px',
    marginLeft: '4px',
    cursor: 'pointer',
    flexShrink: 0,
  }),

  jumpBtn: {
    position: 'fixed' as const,
    bottom: '80px',
    right: '24px',
    zIndex: 100,
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    padding: '6px 14px',
    fontSize: '12px',
    fontFamily: 'var(--font, monospace)',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius, 6px)',
    cursor: 'pointer',
  } as React.CSSProperties,

  statsBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '6px 0',
    fontSize: '11px',
    color: 'var(--fg-muted)',
    borderTop: '1px solid var(--border)',
    marginTop: '8px',
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,

  emptyState: {
    padding: '40px',
    textAlign: 'center' as const,
    color: 'var(--fg-subtle)',
  } as React.CSSProperties,
};

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
      .replace('⧉', '')
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
    const map = new Map<string, { type: string; color: string } | null>();
    const cacheKey = (m: string | undefined) => m || '';
    aggregated.forEach((e) => {
      const key = cacheKey(e.message);
      if (!map.has(key)) {
        const entryType = detectLogType(e.message);
        if (entryType) {
          const opt = TYPE_OPTIONS.find((t) => t.value === entryType);
          map.set(key, { type: entryType, color: opt && 'color' in opt && opt.color ? opt.color : 'var(--fg-muted)' });
        } else {
          map.set(key, null);
        }
      }
    });
    return map;
  }, [aggregated]);

  // --- Derived: auto-refresh button label ---
  const autoLabel = autoRefresh ? '● auto' : '◯ auto';

  // ============================================
  // Render
  // ============================================
  return (
    <div style={styles.container}>
      {/* ===== Filter Bar ===== */}
      <div style={styles.filterBar}>
        {/* Source dropdown */}
        <div style={styles.filterGroup}>
          <select
            style={styles.select}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            {SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Level toggle buttons */}
        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>Level:</span>
          {LEVEL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              style={styles.toggleBtn(level === opt.value)}
              onClick={() => setLevel(level === opt.value ? '' : opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Type toggle buttons */}
        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>Type:</span>
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              style={styles.toggleBtn(
                type === opt.value,
                opt.color ?? undefined,
              )}
              onClick={() => setType(type === opt.value ? '' : opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Lines dropdown */}
        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>Lines:</span>
          <select
            style={{ ...styles.select, width: '70px' }}
            value={lines}
            onChange={(e) => setLines(e.target.value)}
          >
            {LINES_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        {/* Search input */}
        <div style={styles.filterGroup}>
          <span style={styles.filterLabel}>Search:</span>
          <input
            type="text"
            style={styles.searchInput}
            placeholder="keyword..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        {/* Right-side controls */}
        <div style={{ ...styles.filterGroup, marginLeft: 'auto' }}>
          {/* Auto-refresh toggle */}
          <button
            style={styles.iconBtn(autoRefresh)}
            onClick={() => {
              setAutoRefresh((prev) => !prev);
            }}
            title="Toggle auto-refresh"
          >
            {autoLabel}
          </button>

          {/* Mode toggle */}
          <select
            style={{ ...styles.select, width: '60px' }}
            value={mode}
            onChange={(e) => setMode(e.target.value as 'poll' | 'stream')}
            title="Refresh mode"
          >
            <option value="poll">poll</option>
            <option value="stream">stream</option>
          </select>

          {/* Clear button */}
          <button
            style={styles.iconBtn()}
            onClick={() => {
              setLogs([]);
            }}
          >
            Clear
          </button>

          {/* Refresh button */}
          <button style={styles.iconBtn()} onClick={fetchLogs}>
            ↻
          </button>
        </div>
      </div>

      {/* ===== Component filter bar ===== */}
      {component && (
        <div style={styles.componentBar}>
          <span style={{ color: 'var(--fg-muted)' }}>Filtering:</span>
          <span style={{ color: 'var(--teal, #4ecdc4)', fontWeight: 600 }}>
            {component}
          </span>
          <button
            style={{
              ...styles.iconBtn(),
              fontSize: '10px',
              padding: '1px 6px',
            }}
            onClick={() => setComponent('')}
          >
            ✕
          </button>
        </div>
      )}

      {/* ===== Log Panel ===== */}
      <div
        ref={panelRef}
        style={styles.logPanel}
        onScroll={handleScroll}
      >
        {aggregated.length === 0 ? (
          <div style={styles.emptyState}>
            {loading ? 'Loading...' : fetchError ? `Error: ${fetchError}` : 'No log entries'}
          </div>
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
        <button style={styles.jumpBtn} onClick={scrollToBottom}>
          ↓ New logs
        </button>
      )}

      {/* ===== Stats Bar ===== */}
      <div style={styles.statsBar}>
        <span>{stats.total} entries</span>

        {Object.entries(stats.lvlCounts).map(([lvl, count]) =>
          count > 0 ? (
            <span key={lvl} style={{ color: LEVEL_COLORS[lvl] || 'var(--fg-muted)' }}>
              {lvl} {count}
            </span>
          ) : null,
        )}

        {Object.entries(stats.typeCounts).map(([t, c]) => {
          const opt = TYPE_OPTIONS.find((o) => o.value === t);
          return (
            <span
              key={t}
              style={{
                color: (opt && 'color' in opt ? opt.color : null) || 'var(--fg-muted)',
                marginLeft: '6px',
              }}
            >
              {t} {c}
            </span>
          );
        })}

        {stats.componentCount > 0 && (
          <span style={{ marginLeft: 'auto', color: 'var(--fg-subtle)' }}>
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
  entryType: { type: string; color: string } | null;
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

  return (
    <div
      ref={lineRef}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        padding: '1px 4px',
        borderRadius: '3px',
        backgroundColor:
          shortLvl === 'ERR'
            ? 'rgba(255,107,107,0.06)'
            : shortLvl === 'WRN'
              ? 'rgba(255,172,2,0.04)'
              : 'transparent',
        cursor: 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Timestamp */}
      <span style={styles.logTimestamp}>[{time}]</span>

      {/* Level badge */}
      <span style={styles.logLevel(shortLvl)}>{shortLvl}</span>

      {/* Type badge (clickable) */}
      {entryType && (
        <span
          style={styles.typeBadge(entryType.color)}
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
          style={styles.componentTag}
          onClick={(e) => {
            e.stopPropagation();
            onComponentClick();
          }}
          title={`Filter by ${component}`}
        >
          {component}
        </span>
      ) : (
        <span style={{ minWidth: '40px', flexShrink: 0 }} />
      )}

      {/* Message + duplicate count */}
      <span style={styles.logMessage}>
        {message}
        {count > 1 && (
          <span style={styles.duplicateBadge}>×{count}</span>
        )}
      </span>

      {/* Copy icon */}
      <span
        style={{
          ...styles.copyIcon,
          ...(hovered || copied ? styles.copyIconVisible : {}),
        }}
        onClick={handleCopy}
        title="Copy"
      >
        {copied ? '✓' : '⧉'}
      </span>
    </div>
  );
}
