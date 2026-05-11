'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/app/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { RiFolderOpenLine, RiFileLine, RiRefreshLine, RiHome3Line, RiMenuFoldLine, RiSave3Line } from '@remixicon/react';

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

// ============================================
// FilesPage Component
// ============================================

export default function FilesPage() {
  const [dirPath, setDirPath] = useState('');
  const [items, setItems] = useState<FileItem[]>([]);
  const [listPath, setListPath] = useState<string | undefined>('');
  const [listParent, setListParent] = useState<string | undefined>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleResize = useCallback(() => setIsMobile(window.innerWidth <= 768), []);
  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  const loadFileExplorer = useCallback(async (path: string) => {
    setLoading(true); setError(null); setDirPath(path);
    try {
      const res = await api.get<ListResponse>(`/api/files/list?path=${encodeURIComponent(path)}`);
      if (!res.ok) { setError(res.error || 'Failed to load directory'); setItems([]); setListPath(undefined); setListParent(undefined); return; }
      setItems(res.items || []); setListPath(res.path); setListParent(res.parent); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load'); setItems([]);
    } finally { setLoading(false); }
  }, []);

  const openFileInEditor = useCallback(async (filePath: string) => {
    setCurrentFilePath(filePath); setFileContent('Loading...'); setEditorLoading(true);
    try {
      const res = await api.get<ReadResponse>(`/api/file?path=${encodeURIComponent(filePath)}`);
      if (res.ok) setFileContent(res.content || '(empty file)');
      else setFileContent(`Error: ${res.error || 'Could not read file'}\nPath: ${filePath}`);
    } catch (e) { setFileContent(`Network error: ${e instanceof Error ? e.message : 'Unknown'}`); }
    finally { setEditorLoading(false); }
  }, []);

  const saveCurrentFile = useCallback(async () => {
    if (!currentFilePath) return;
    setSaving(true);
    try {
      const res = await api.post<{ ok: boolean; error?: string }>('/api/file', { path: currentFilePath, content: fileContent });
      if (res.ok) showToast('File saved', 'success');
      else showToast(res.error || 'Save failed', 'error');
    } catch (e) { showToast(`Save failed: ${e instanceof Error ? e.message : 'Unknown'}`, 'error'); }
    finally { setSaving(false); }
  }, [currentFilePath, fileContent, showToast]);

  useEffect(() => { loadFileExplorer(''); }, [loadFileExplorer]);

  const navTo = useCallback((path: string, isFile = false) => {
    if (isFile) openFileInEditor(path);
    else loadFileExplorer(path);
    if (isMobile) setSidebarOpen(false);
  }, [loadFileExplorer, openFileInEditor, isMobile]);

  const breadcrumbParts = listPath ? listPath.split('/').filter(Boolean) : [];

  const treeContent = (
    <div className="flex-1 overflow-y-auto py-2">
      {/* Breadcrumb */}
      <div className="flex items-center gap-0.5 whitespace-nowrap overflow-x-auto px-3 py-2 border-b text-xs font-mono text-muted-foreground">
        <span className="text-accent cursor-pointer shrink-0" onClick={() => navTo('')}>
          <RiHome3Line className="inline h-3.5 w-3.5" /> .hermes
        </span>
        {breadcrumbParts.map((part, i) => {
          const accumPath = breadcrumbParts.slice(0, i + 1).join('/');
          return (
            <span key={i} className="shrink-0">
              <span className="px-1 text-muted-foreground/50">/</span>
              <span className="text-accent cursor-pointer" onClick={() => navTo(accumPath)}>{part}</span>
            </span>
          );
        })}
      </div>

      {loading && <div className="p-10 text-center text-muted-foreground italic text-sm">Loading...</div>}
      {!loading && error && <div className="p-3 text-destructive text-xs break-all">{error}</div>}

      {!loading && !error && (
        <>
          {listParent !== undefined && (
            <div
              className="flex items-center px-3 py-2 cursor-pointer text-accent text-sm font-mono transition-colors hover:bg-accent/5 min-h-[36px]"
              onClick={() => navTo(listParent || '')}
            >
              <RiFolderOpenLine className="mr-1.5 h-4 w-4 shrink-0" /> ..
            </div>
          )}
          {items.length === 0 && listParent === undefined && (
            <div className="p-6 text-center text-muted-foreground/60 text-xs">Empty directory</div>
          )}
          {items.map((item) => {
            const isDir = item.type === 'directory';
            return (
              <div
                key={item.path}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer text-sm font-mono transition-colors min-h-[36px] select-none ${
                  isDir ? 'text-accent hover:bg-accent/5' : 'text-foreground hover:bg-muted/30'
                } ${currentFilePath === item.path ? 'bg-muted/40' : ''}`}
                onClick={() => navTo(item.path, !isDir)}
              >
                <span className="flex items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap">
                  {isDir ? <RiFolderOpenLine className="h-4 w-4 shrink-0" /> : <RiFileLine className="h-4 w-4 shrink-0" />}
                  {item.name}
                </span>
                {item.type === 'file' && (
                  <span className="text-[11px] text-muted-foreground/70 shrink-0 ml-2">{formatFileSize(item.size)}</span>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-start px-4 py-3 shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-wide">File Explorer</h1>
          <p className="text-sm text-muted-foreground mt-0.5">.hermes directory browser</p>
        </div>
        <div className="flex gap-2">
          {isMobile && (
            <Button variant="outline" size="sm" onClick={() => setSidebarOpen(p => !p)}>
              <RiMenuFoldLine className="h-4 w-4" /> Files
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => navTo('')} title="Go to root">
            <RiHome3Line className="h-3.5 w-3.5 mr-1" /> Root
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadFileExplorer(dirPath)} title="Refresh">
            <RiRefreshLine className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* Split View */}
      <div className="flex flex-1 overflow-hidden border-t">
        {/* Mobile backdrop */}
        {isMobile && <div className={`fixed inset-0 bg-black/50 z-[299] ${sidebarOpen ? 'block' : 'hidden'}`} onClick={() => setSidebarOpen(false)} />}

        {/* Left: File tree */}
        <div className={`${
          isMobile
            ? `fixed top-0 left-0 bottom-0 w-[280px] z-[300] bg-background border-r transition-transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
            : 'w-[280px] min-w-[280px] border-r'
        } flex flex-col overflow-hidden`}>
          {treeContent}
        </div>

        {/* Right: Editor */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {currentFilePath ? (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b text-xs font-mono shrink-0 gap-2">
                <span className="text-muted-foreground truncate flex-1">{currentFilePath}</span>
                <div className="flex gap-1">
                  {isMobile && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSidebarOpen(p => !p)}><RiMenuFoldLine className="h-4 w-4" /></Button>}
                  <Button size="sm" onClick={saveCurrentFile} disabled={saving || editorLoading}>
                    <RiSave3Line className="h-3.5 w-3.5 mr-1" /> {saving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
              <textarea
                ref={textareaRef}
                className={`flex-1 w-full bg-input border-0 text-foreground font-mono text-[13px] leading-relaxed px-4 py-3 resize-none outline-none tab-size-2 ${editorLoading ? 'text-muted-foreground cursor-not-allowed' : ''}`}
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                disabled={editorLoading}
                spellCheck={false}
                placeholder="Select a file from the tree"
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground/60 italic text-sm">
              Select a file from the tree to edit
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[9999] px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
