'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/app/lib/api-client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Skill {
  num?: string;
  name: string;
  description: string;
  source: string;
  trust: string;
  identifier?: string;
}

interface Profile {
  name: string;
  active: boolean;
  alias?: string;
  model?: string;
}

// ─── Parse CLI box-drawing table output ──────────────────────────────────────

function parseSkillTable(output: string): Skill[] {
  const text = String(output || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  const lines = text.split('\n');
  const skills: Skill[] = [];
  const rowPattern = /[│┃]\s*([^│┃\s][^│┃]*?)\s*[│┃]\s*([^│┃]*?)\s*[│┃]\s*(\S+)\s*[│┃]\s*(\S+)\s*[│┃]\s*([^│┃]*?)\s*[│┃]/;
  for (const line of lines) {
    // Skip box-drawing header/footer lines
    if (line.includes('┏') || line.includes('┗') || line.includes('┡') || line.includes('┩') || line.includes('╍')) continue;
    const match = line.match(rowPattern);
    if (match) {
      const name = match[1].trim();
      if (!name || name === 'Name' || name === '#') continue;
      skills.push({
        name,
        description: match[2].trim(),
        source: match[3].trim(),
        trust: match[4].trim(),
        identifier: match[5].trim(),
      });
    }
  }
  return skills;
}

// Also parse the browse-specific table format (with leading number column)
function parseBrowseTable(output: string): Skill[] {
  const text = String(output || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  const lines = text.split('\n');
  const skills: Skill[] = [];
  for (const line of lines) {
    if (line.includes('┏') || line.includes('┗') || line.includes('┡') || line.includes('┩') || line.includes('╍')) continue;
    const match = line.match(/[│|]\s*(\d+)\s*[│|]\s*([^\s│|]+)\s*[│|]\s*(.{10,}?)\s*[│|]\s*(\S+)\s*[│|]\s*(.+?)\s*[│|]/);
    if (match) {
      skills.push({
        num: match[1],
        name: match[2].trim(),
        description: match[3].trim().replace(/\.\.\.$/, ''),
        source: match[4].trim(),
        trust: match[5].trim(),
      });
    }
  }
  return skills;
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

const searchInputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: '12px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--fg)',
  fontFamily: 'var(--font)',
  outline: 'none',
  width: '220px',
  transition: 'border-color 0.2s',
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

const btnOkStyle: React.CSSProperties = {
  ...btnGhostStyle,
  cursor: 'default',
  opacity: 0.7,
};

const btnSmStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '11px',
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

const errorStyle: React.CSSProperties = {
  color: 'var(--red)',
  fontSize: '13px',
  padding: '8px 0',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function SkillsPage() {
  // Data state
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Installed skills tracking
  const [installedSkills, setInstalledSkills] = useState<Set<string>>(new Set());

  // Profiles for install picker
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // Inspect modal
  const [inspectTarget, setInspectTarget] = useState<string | null>(null);
  const [inspectOutput, setInspectOutput] = useState<string>('');
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  // Install modal
  const [installTarget, setInstallTarget] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<string>('');
  const [installLoading, setInstallLoading] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState('');

  // ── Load profiles & installed skills on mount ──────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const profRes = await api.get<{ ok: boolean; profiles: Profile[] }>('/api/profiles');
        if (!cancelled && profRes.ok && profRes.profiles) {
          setProfiles(profRes.profiles);
          const activeProfile = profRes.profiles.find(p => p.active);
          const profileName = activeProfile?.name || 'default';
          setSelectedProfile(profileName);

          try {
            const instRes = await api.get<{ ok: boolean; output: string }>(`/api/skills/list/${encodeURIComponent(profileName)}`);
            if (!cancelled && instRes.ok && instRes.output) {
              const names = new Set<string>();
              const lines = instRes.output.split('\n');
              for (const line of lines) {
                const match = line.match(/[│┃]\s*([^\s│┃][^\s│┃]*)\s*[│┃]/);
                if (match) names.add(match[1].trim());
              }
              setInstalledSkills(names);
            }
          } catch { /* silently ignore */ }
        }
      } catch { /* silently ignore */ }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // ── Load page of skills ────────────────────────────────────────────────────

  const loadPage = useCallback(async (page: number) => {
    setLoading(true);
    setError(null);
    setIsSearching(false);
    setCurrentPage(page);

    try {
      const res = await api.get<{ ok: boolean; error?: string; output?: string }>(`/api/skills/browse/${page}`);
      if (!res.ok) {
        setError(res.error || 'Failed to load skills');
        setSkills([]);
        return;
      }

      const output = res.output || '';

      // Parse pagination from output
      const pageMatch = output.match(/page (\d+)\/(\d+)/i);
      if (pageMatch) {
        setCurrentPage(parseInt(pageMatch[1]));
        setTotalPages(parseInt(pageMatch[2]));
      }

      const parsed = parseBrowseTable(output);
      setSkills(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load skills');
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Load first page on mount ───────────────────────────────────────────────

  useEffect(() => {
    loadPage(1);
  }, [loadPage]);

  // ── Search handler (debounced) ─────────────────────────────────────────────

  const handleSearchInput = useCallback((value: string) => {
    setSearchQuery(value);

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    if (value.trim().length < 2) {
      // Revert to browse mode
      setIsSearching(false);
      loadPage(1);
      return;
    }

    // Debounce search
    searchTimerRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      setIsSearching(true);

      try {
        const res = await api.get<{ ok: boolean; error?: string; output?: string }>(`/api/skills/search/${encodeURIComponent(value.trim())}`);
        if (res.ok && res.output) {
          const parsed = parseSkillTable(res.output);
          setSkills(parsed);
        } else {
          setError(res.error || 'Search failed');
          setSkills([]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed');
        setSkills([]);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [loadPage]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  // ── Inspect skill ──────────────────────────────────────────────────────────

  const handleInspect = useCallback(async (name: string) => {
    setInspectTarget(name);
    setInspectOutput('');
    setInspectError(null);
    setInspectLoading(true);

    try {
      const res = await api.get<{ ok: boolean; error?: string; output?: string }>(`/api/skills/inspect/${encodeURIComponent(name)}`);
      if (res.ok) {
        setInspectOutput(res.output || '');
      } else {
        setInspectError(res.error || 'Failed to load preview');
      }
    } catch (e) {
      setInspectError(e instanceof Error ? e.message : 'Failed to load preview');
    } finally {
      setInspectLoading(false);
    }
  }, []);

  const closeInspect = useCallback(() => {
    setInspectTarget(null);
    setInspectOutput('');
    setInspectError(null);
  }, []);

  // ── Install skill modal ────────────────────────────────────────────────────

  const handleInstall = useCallback((name: string) => {
    setInstallTarget(name);
    setInstallStatus('');
    setInstallLoading(false);

    // Re-select active profile
    const activeProfile = profiles.find(p => p.active);
    if (activeProfile) setSelectedProfile(activeProfile.name);
  }, [profiles]);

  const closeInstall = useCallback(() => {
    setInstallTarget(null);
    setInstallStatus('');
  }, []);

  const doInstall = useCallback(async () => {
    if (!installTarget) return;
    setInstallLoading(true);
    setInstallStatus('');

    try {
      const res = await api.post<{ ok: boolean; error?: string; output?: string }>('/api/skills/install', {
        skill: installTarget,
        profile: selectedProfile,
      });

      if (res.ok) {
        setInstallStatus(`✅ Installed to ${selectedProfile || 'default'}!`);
        // Add to installed set
        setInstalledSkills(prev => new Set(prev).add(installTarget));
        // Auto-close after 1.5s
        setTimeout(() => {
          setInstallTarget(null);
          setInstallStatus('');
        }, 1500);
      } else {
        setInstallStatus(`❌ ${res.output || res.error || 'Install failed'}`);
      }
    } catch (e) {
      setInstallStatus(`❌ ${e instanceof Error ? e.message : 'Install failed'}`);
    } finally {
      setInstallLoading(false);
    }
  }, [installTarget, selectedProfile]);

  // ── Is a skill installed? ──────────────────────────────────────────────────

  const isInstalled = useCallback((skill: Skill) => {
    const key = skill.identifier || skill.name;
    return installedSkills.has(key);
  }, [installedSkills]);

  // ── Source badge color ─────────────────────────────────────────────────────

  const getSourceBadgeStyle = useCallback((source: string): React.CSSProperties => {
    const isOfficial = source === 'official';
    return {
      ...badgeStyle,
      background: isOfficial ? 'var(--accent-dim)' : 'transparent',
      color: isOfficial ? 'var(--accent)' : 'var(--fg-muted)',
    };
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px', height: '100%', overflowY: 'auto' }}>
      {/* ── Page Header ────────────────────────────────────────────────── */}
      <div style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>Skills Hub</div>
          <div style={pageSubtitleStyle}>Browse, install, and manage skills</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search skills..."
            value={searchQuery}
            onChange={e => handleSearchInput(e.target.value)}
            style={searchInputStyle}
          />
          <button
            style={btnGhostStyle}
            onClick={() => loadPage(currentPage)}
            title="Refresh"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Error message ──────────────────────────────────────────────── */}
      {error && (
        <div style={errorStyle}>{error}</div>
      )}

      {/* ── Loading ────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', color: 'var(--fg-muted)', fontStyle: 'italic' }}>
          {isSearching ? 'Searching...' : `Loading page ${currentPage}...`}
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────────────────── */}
      {!loading && !error && skills.length === 0 && (
        <div style={{ ...cardStyle, alignItems: 'center', justifyContent: 'center', padding: '40px', color: 'var(--fg-muted)' }}>
          {isSearching ? `No skills found for "${searchQuery}"` : `No skills found on page ${currentPage}`}
        </div>
      )}

      {/* ── Search results header ──────────────────────────────────────── */}
      {!loading && isSearching && skills.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: '16px' }}>
          <div style={cardTitleStyle}>Search Results ({skills.length})</div>
        </div>
      )}

      {/* ── Skill cards grid ───────────────────────────────────────────── */}
      {!loading && skills.length > 0 && (
        <div style={cardGridStyle}>
          {skills.map((s, i) => {
            const installed = isInstalled(s);
            return (
              <div key={s.num || s.identifier || s.name || i} style={cardStyle}>
                <div style={cardTitleStyle}>{s.name}</div>
                <div style={{ fontSize: '12px', color: 'var(--fg-muted)', marginTop: '4px', flex: 1 }}>
                  {s.description}
                </div>
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={getSourceBadgeStyle(s.source)}>{s.source}</span>
                  {s.trust && (
                    <span style={{ ...badgeStyle, opacity: 0.7 }}>{s.trust}</span>
                  )}
                </div>
                <div style={{ marginTop: '10px', display: 'flex', gap: '6px' }}>
                  <button
                    style={{ ...btnGhostStyle, ...btnSmStyle }}
                    onClick={() => handleInspect(s.identifier || s.name)}
                  >
                    🔍 Preview
                  </button>
                  {installed ? (
                    <button
                      style={{ ...btnOkStyle, ...btnSmStyle }}
                      disabled
                    >
                      ✅ Installed
                    </button>
                  ) : (
                    <button
                      style={{ ...btnPrimaryStyle, ...btnSmStyle }}
                      onClick={() => handleInstall(s.identifier || s.name)}
                    >
                      ⬇ Install
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Pagination ─────────────────────────────────────────────────── */}
      {!isSearching && totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
          {currentPage > 1 && (
            <button
              style={btnGhostStyle}
              onClick={() => loadPage(currentPage - 1)}
            >
              ← Page {currentPage - 1}
            </button>
          )}
          <span style={{ color: 'var(--fg-muted)', padding: '8px', fontSize: '13px' }}>
            Page {currentPage} / {totalPages}
          </span>
          {currentPage < totalPages && (
            <button
              style={btnGhostStyle}
              onClick={() => loadPage(currentPage + 1)}
            >
              Page {currentPage + 1} →
            </button>
          )}
        </div>
      )}

      {/* ── Inspect Modal ──────────────────────────────────────────────── */}
      {inspectTarget && (
        <div
          style={modalOverlayStyle}
          onClick={e => { if (e.target === e.currentTarget) closeInspect(); }}
        >
          <div style={{ ...modalCardStyle, width: '600px' }}>
            <div style={modalTitleStyle}>{inspectTarget}</div>
            {inspectLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', color: 'var(--fg-muted)', fontStyle: 'italic' }}>
                Loading preview...
              </div>
            ) : inspectError ? (
              <div style={errorStyle}>{inspectError}</div>
            ) : (
              <pre style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '11px',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: '50vh',
                overflowY: 'auto',
                color: 'var(--fg)',
                fontFamily: 'var(--font)',
                margin: 0,
              }}>
                {inspectOutput}
              </pre>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button style={btnGhostStyle} onClick={closeInspect}>Close</button>
              {!isInstalled({ name: inspectTarget, description: '', source: '', trust: '' }) && (
                <button
                  style={btnPrimaryStyle}
                  onClick={() => { closeInspect(); handleInstall(inspectTarget); }}
                >
                  ⬇ Install
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Install Modal ──────────────────────────────────────────────── */}
      {installTarget && (
        <div
          style={modalOverlayStyle}
          onClick={e => { if (e.target === e.currentTarget) closeInstall(); }}
        >
          <div style={{ ...modalCardStyle, width: '450px' }}>
            <div style={modalTitleStyle}>Install: {installTarget}</div>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--fg-muted)', marginBottom: '8px' }}>
                Select agent profile
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {profiles.length > 0 ? profiles.map(p => (
                  <label
                    key={p.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      border: `1px solid ${selectedProfile === p.name ? 'var(--accent)' : 'var(--border)'}`,
                      background: selectedProfile === p.name ? 'var(--accent-dim)' : 'var(--bg-card)',
                    }}
                  >
                    <input
                      type="radio"
                      name="install-profile"
                      value={p.name}
                      checked={selectedProfile === p.name}
                      onChange={e => setSelectedProfile(e.target.value)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>{p.name}</span>
                    {p.alias && p.alias !== p.name && (
                      <span style={{ color: 'var(--fg-muted)', fontSize: '11px' }}>({p.alias})</span>
                    )}
                    {p.active && (
                      <span style={{
                        ...badgeStyle,
                        fontSize: '9px',
                        background: 'var(--accent-dim)',
                        color: 'var(--accent)',
                        borderColor: 'transparent',
                      }}>
                        active
                      </span>
                    )}
                    <span style={{ color: 'var(--fg-muted)', fontSize: '11px', marginLeft: 'auto' }}>
                      {p.model || ''}
                    </span>
                  </label>
                )) : (
                  <div style={{ color: 'var(--fg-muted)', padding: '12px' }}>No profiles found</div>
                )}
              </div>
            </div>

            {installStatus && (
              <div style={{
                fontSize: '13px',
                padding: '8px 0',
                color: installStatus.startsWith('✅') ? 'var(--green)' : 'var(--red)',
              }}>
                {installStatus}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button style={btnGhostStyle} onClick={closeInstall} disabled={installLoading}>
                Cancel
              </button>
              <button
                style={btnPrimaryStyle}
                onClick={doInstall}
                disabled={installLoading || !selectedProfile}
              >
                {installLoading ? 'Installing...' : '⬇ Install'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
