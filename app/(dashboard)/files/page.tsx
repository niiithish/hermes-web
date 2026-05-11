'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/app/lib/api-client';

// ============================================
// Types
// ============================================

interface FileItem {
  type: 'directory' | 'file';
  name: string;
  path: string;
  size?: number;
}

interface ListResponse {
  ok: boolean;
  path?: string;
  parent?: string;
  items?: FileItem[];
  error?: string;
}

interface ReadResponse {
  ok: boolean;
  content?: string;
  error?: string;
}

// ============================================
// Helpers
// ============================================

function formatFileSize(bytes: number | undefined): string {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return bytes + 'B';
}

function escapePathSegment(segment: string): string {
  return segment.replace(/'/g, "\\'");
}

// ============================================
// Styles
// ============================================

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '16px 16px 12px',
    flexShrink: 0,
  } as React.CSSProperties,

  headerLeft: {
    display: 'flex',
    flexDirection: 'column' as const,
  } as React.CSSProperties,

  headerTitle: {
    fontSize: '20px',
    fontWeight: 600,
    color: 'var(--fg)',
  } as React.CSSProperties,

  headerSubtitle: {
    fontSize: '13px',
    color: 'var(--fg-muted)',
    marginTop: '2px',
  } as React.CSSProperties,

  headerActions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
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
    transition: 'background 0.15s, border-color 0.15s',
    whiteSpace: 'nowrap' as const,
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
    transition: 'opacity 0.15s',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  splitView: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    borderTop: '1px solid var(--border)',
  } as React.CSSProperties,

  // Left panel — file tree
  treePanel: {
    width: '280px',
    minWidth: '280px',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  } as React.CSSProperties,

  treePanelMobile: (open: boolean): React.CSSProperties => ({
    position: 'fixed' as const,
    top: 0,
    left: 0,
    bottom: 0,
    width: '280px',
    zIndex: 300,
    background: 'var(--bg)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    transform: open ? 'translateX(0)' : 'translateX(-100%)',
    transition: 'transform 0.25s ease',
  }),

  backdrop: (open: boolean): React.CSSProperties => ({
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 299,
    display: open ? 'block' : 'none',
  }),

  treeInner: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '8px 0',
  } as React.CSSProperties,

  breadcrumb: {
    display: 'flex',
    flexWrap: 'nowrap' as const,
    overflowX: 'auto' as const,
    whiteSpace: 'nowrap' as const,
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
    fontSize: '12px',
    fontFamily: 'var(--font, monospace)',
    color: 'var(--fg-muted)',
    gap: '2px',
    alignItems: 'center',
  } as React.CSSProperties,

  breadcrumbLink: {
    color: 'var(--accent)',
    cursor: 'pointer',
    textDecoration: 'none',
    whiteSpace: 'nowrap' as const,
    fontSize: '12px',
  } as React.CSSProperties,

  breadcrumbSep: {
    color: 'var(--fg-subtle)',
    padding: '0 2px',
    flexShrink: 0,
  } as React.CSSProperties,

  fileItem: (isDir: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: 'var(--font, monospace)',
    color: isDir ? 'var(--accent)' : 'var(--fg)',
    transition: 'background 0.1s',
    minHeight: '36px',
    userSelect: 'none' as const,
  }),

  fileItemName: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    overflow: 'hidden',
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  fileMeta: {
    fontSize: '11px',
    color: 'var(--fg-subtle)',
    flexShrink: 0,
    marginLeft: '8px',
  } as React.CSSProperties,

  // Right panel — editor
  editorPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    minWidth: 0,
  } as React.CSSProperties,

  editorToolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
    fontSize: '12px',
    fontFamily: 'var(--font, monospace)',
    flexShrink: 0,
    gap: '8px',
  } as React.CSSProperties,

  editorPath: {
    color: 'var(--fg-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
    flex: 1,
  } as React.CSSProperties,

  editorTextarea: {
    flex: 1,
    width: '100%',
    background: 'var(--bg-input)',
    border: 'none',
    color: 'var(--fg)',
    fontFamily: 'var(--font-mono, var(--font, monospace))',
    fontSize: '13px',
    lineHeight: '1.6',
    padding: '12px 16px',
    resize: 'none' as const,
    outline: 'none',
    tabSize: 2,
  } as React.CSSProperties,

  editorTextareaDisabled: {
    flex: 1,
    width: '100%',
    background: 'var(--bg-input)',
    border: 'none',
    color: 'var(--fg-muted)',
    fontFamily: 'var(--font-mono, var(--font, monospace))',
    fontSize: '13px',
    lineHeight: '1.6',
    padding: '12px 16px',
    resize: 'none' as const,
    outline: 'none',
    tabSize: 2,
    cursor: 'not-allowed',
  } as React.CSSProperties,

  emptyEditor: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--fg-subtle)',
    fontFamily: 'var(--font, monospace)',
    fontSize: '14px',
    fontStyle: 'italic',
  } as React.CSSProperties,

  loadingState: {
    padding: '40px',
    textAlign: 'center' as const,
    color: 'var(--fg-muted)',
    fontFamily: 'var(--font, monospace)',
    fontSize: '13px',
  } as React.CSSProperties,

  errorState: {
    padding: '12px',
    color: 'var(--red)',
    fontFamily: 'var(--font, monospace)',
    fontSize: '12px',
    wordBreak: 'break-all' as const,
  } as React.CSSProperties,

  emptyState: {
    padding: '24px 12px',
    color: 'var(--fg-subtle)',
    fontFamily: 'var(--font, monospace)',
    fontSize: '12px',
    textAlign: 'center' as const,
  } as React.CSSProperties,

  toast: (type: 'success' | 'error'): React.CSSProperties => ({
    position: 'fixed' as const,
    bottom: '24px',
    right: '24px',
    padding: '10px 20px',
    borderRadius: 'var(--radius, 6px)',
    fontSize: '13px',
    fontWeight: 500,
    zIndex: 9999,
    background: type === 'success' ? 'var(--green)' : 'var(--red)',
    color: '#fff',
    boxShadow: 'var(--shadow)',
    fontFamily: 'var(--font, monospace)',
  }),
};

// ============================================
// FilesPage Component
// ============================================

export default function FilesPage() {
  // ── File tree state ───────────────────────────────────────────────────
  const [dirPath, setDirPath] = useState('');
  const [items, setItems] = useState<FileItem[]>([]);
  const [listPath, setListPath] = useState<string | undefined>('');
  const [listParent, setListParent] = useState<string | undefined>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Editor state ──────────────────────────────────────────────────────
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── UI state ──────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Detect mobile ─────────────────────────────────────────────────────
  const handleResize = useCallback(() => {
    setIsMobile(window.innerWidth <= 768);
  }, []);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  // ── Toast helper ──────────────────────────────────────────────────────
  const showToast = useCallback(
    (message: string, type: 'success' | 'error') => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast({ message, type });
      toastTimerRef.current = setTimeout(() => setToast(null), 3000);
    },
    [],
  );

  // Cleanup toast timer
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // ── Load file explorer (directory listing) ────────────────────────────
  const loadFileExplorer = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      setDirPath(path);

      try {
        const res = await api.get<ListResponse>(
          `/api/files/list?path=${encodeURIComponent(path)}`,
        );

        if (!res.ok) {
          setError(res.error || 'Failed to load directory');
          setItems([]);
          setListPath(undefined);
          setListParent(undefined);
          return;
        }

        setItems(res.items || []);
        setListPath(res.path);
        setListParent(res.parent);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
        setItems([]);
        setListPath(undefined);
        setListParent(undefined);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // ── Open file in editor ───────────────────────────────────────────────
  const openFileInEditor = useCallback(
    async (filePath: string) => {
      setCurrentFilePath(filePath);
      setFileContent('Loading...');
      setEditorLoading(true);

      try {
        const res = await api.get<ReadResponse>(
          `/api/file?path=${encodeURIComponent(filePath)}`,
        );

        if (res.ok) {
          setFileContent(res.content || '(empty file)');
        } else {
          setFileContent(
            `Error: ${res.error || 'Could not read file'}\nPath: ${filePath}`,
          );
        }
      } catch (e) {
        setFileContent(
          `Network error: ${e instanceof Error ? e.message : 'Unknown error'}`,
        );
      } finally {
        setEditorLoading(false);
      }
    },
    [],
  );

  // ── Save current file ─────────────────────────────────────────────────
  const saveCurrentFile = useCallback(async () => {
    if (!currentFilePath) return;
    setSaving(true);

    try {
      const res = await api.post<{ ok: boolean; error?: string }>(
        '/api/file',
        {
          path: currentFilePath,
          content: fileContent,
        },
      );

      if (res.ok) {
        showToast('File saved', 'success');
      } else {
        showToast(res.error || 'Save failed', 'error');
      }
    } catch (e) {
      showToast(
        `Save failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
        'error',
      );
    } finally {
      setSaving(false);
    }
  }, [currentFilePath, fileContent, showToast]);

  // ── Initial load ──────────────────────────────────────────────────────
  useEffect(() => {
    loadFileExplorer('');
  }, [loadFileExplorer]);

  // ── Close sidebar on mobile when navigating ───────────────────────────
  const handleNavigateDir = useCallback(
    (path: string) => {
      loadFileExplorer(path);
      if (isMobile) setSidebarOpen(false);
    },
    [loadFileExplorer, isMobile],
  );

  const handleNavigateFile = useCallback(
    (path: string) => {
      openFileInEditor(path);
      if (isMobile) setSidebarOpen(false);
    },
    [openFileInEditor, isMobile],
  );

  // ── Build breadcrumb parts ────────────────────────────────────────────
  const breadcrumbParts = listPath
    ? listPath.split('/').filter(Boolean)
    : [];

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={styles.container}>
      {/* ===== Header ===== */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.headerTitle}>File Explorer</div>
          <div style={styles.headerSubtitle}>.hermes directory browser</div>
        </div>
        <div style={styles.headerActions}>
          {isMobile && (
            <button
              style={styles.btnGhost}
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label="Toggle file sidebar"
            >
              ☰ Files
            </button>
          )}
          <button
            style={styles.btnGhost}
            onClick={() => handleNavigateDir('')}
            title="Go to root"
          >
            ⌂ Root
          </button>
          <button
            style={styles.btnGhost}
            onClick={() => loadFileExplorer(dirPath)}
            title="Refresh current directory"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ===== Split View ===== */}
      <div style={styles.splitView}>
        {/* ===== Mobile backdrop ===== */}
        {isMobile && (
          <div
            style={styles.backdrop(sidebarOpen)}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ===== Left panel: File tree ===== */}
        <div
          style={
            isMobile
              ? styles.treePanelMobile(sidebarOpen)
              : styles.treePanel
          }
        >
          <div style={styles.treeInner}>
            {/* Breadcrumb */}
            <div style={styles.breadcrumb}>
              <span
                style={styles.breadcrumbLink}
                onClick={() => handleNavigateDir('')}
              >
                ⌂ .hermes
              </span>
              {breadcrumbParts.map((part, i) => {
                const accumPath = breadcrumbParts
                  .slice(0, i + 1)
                  .join('/');
                return (
                  <span key={i}>
                    <span style={styles.breadcrumbSep}> / </span>
                    <span
                      style={styles.breadcrumbLink}
                      onClick={() => handleNavigateDir(accumPath)}
                    >
                      {part}
                    </span>
                  </span>
                );
              })}
            </div>

            {/* Loading */}
            {loading && (
              <div style={styles.loadingState}>Loading...</div>
            )}

            {/* Error */}
            {!loading && error && (
              <div style={styles.errorState}>{error}</div>
            )}

            {/* File list */}
            {!loading && !error && (
              <>
                {/* Parent directory */}
                {listParent !== undefined && (
                  <div
                    style={styles.fileItem(true)}
                    onClick={() => handleNavigateDir(listParent || '')}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        'var(--bg-panel-hover)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        'transparent';
                    }}
                  >
                    <span style={styles.fileItemName}>📁 ..</span>
                  </div>
                )}

                {items.length === 0 && listParent === undefined && (
                  <div style={styles.emptyState}>Empty directory</div>
                )}

                {items.map((item) => {
                  const isDir = item.type === 'directory';
                  const icon = isDir ? '📁' : '📄';
                  const size = item.type === 'file' ? (
                    <span style={styles.fileMeta}>
                      {formatFileSize(item.size)}
                    </span>
                  ) : null;

                  return (
                    <div
                      key={item.path}
                      style={{
                        ...styles.fileItem(isDir),
                        ...(currentFilePath === item.path
                          ? { background: 'var(--bg-panel-hover)' }
                          : {}),
                      }}
                      onClick={() =>
                        isDir
                          ? handleNavigateDir(item.path)
                          : handleNavigateFile(item.path)
                      }
                      onMouseEnter={(e) => {
                        if (currentFilePath !== item.path) {
                          (e.currentTarget as HTMLElement).style.background =
                            'var(--bg-panel-hover)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (currentFilePath !== item.path) {
                          (e.currentTarget as HTMLElement).style.background =
                            'transparent';
                        }
                      }}
                    >
                      <span style={styles.fileItemName}>
                        {icon} {item.name}
                      </span>
                      {size}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* ===== Right panel: Editor ===== */}
        <div style={styles.editorPanel}>
          {currentFilePath ? (
            <>
              {/* Toolbar */}
              <div style={styles.editorToolbar}>
                <span style={styles.editorPath}>{currentFilePath}</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {isMobile && (
                    <button
                      style={styles.btnGhost}
                      onClick={() => setSidebarOpen((prev) => !prev)}
                      aria-label="Toggle file sidebar"
                    >
                      ☰
                    </button>
                  )}
                  <button
                    style={{
                      ...styles.btnPrimary,
                      opacity: saving ? 0.7 : 1,
                    }}
                    onClick={saveCurrentFile}
                    disabled={saving || editorLoading}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>

              {/* Editor textarea */}
              <textarea
                ref={textareaRef}
                style={
                  editorLoading
                    ? styles.editorTextareaDisabled
                    : styles.editorTextarea
                }
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                disabled={editorLoading}
                spellCheck={false}
                placeholder="Select a file from the tree"
              />
            </>
          ) : (
            <div style={styles.emptyEditor}>
              Select a file from the tree to edit
            </div>
          )}
        </div>
      </div>

      {/* ===== Toast ===== */}
      {toast && (
        <div style={styles.toast(toast.type)}>{toast.message}</div>
      )}
    </div>
  );
}
