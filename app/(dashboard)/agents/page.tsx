'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/lib/api-client';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RiAddLine, RiRefreshLine, RiDeleteBin6Line, RiFileCopyLine, RiCheckLine } from '@remixicon/react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentProfile {
  name: string;
  active: boolean;
  gateway?: string;
  model?: string;
  alias?: string;
}

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
    <ScrollArea className="h-full">
      <div className="p-6">
        {/* ── Page Header ────────────────────────────────────────────────── */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-wider">Agents</h1>
            <p className="text-xs text-muted-foreground mt-1">Manage your Hermes profiles</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleOpenCreate}>
              <RiAddLine />
              Create Agent
            </Button>
            <Button variant="outline" onClick={loadAgents}>
              <RiRefreshLine />
              Refresh
            </Button>
          </div>
        </div>

        {/* ── Error message ──────────────────────────────────────────────── */}
        {error && <p className="text-destructive text-xs py-2">{error}</p>}

        {/* ── Loading ────────────────────────────────────────────────────── */}
        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground italic gap-2">
            <Spinner />
            Loading agents...
          </div>
        )}

        {/* ── Empty state ────────────────────────────────────────────────── */}
        {!loading && !error && agents.length === 0 && (
          <Card className="items-center justify-center py-10">
            <CardContent className="text-muted-foreground text-center">
              No agents found. Create your first agent profile to get started.
            </CardContent>
          </Card>
        )}

        {/* ── Agent cards grid ───────────────────────────────────────────── */}
        {!loading && agents.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            {agents.map((p) => {
              const isRunning = p.gateway === 'running';
              return (
                <Card key={p.name}>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <CardTitle>{p.name}</CardTitle>
                      {p.active && <Badge>default</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex justify-between items-center py-1.5 border-b text-xs">
                      <span className="text-muted-foreground shrink-0 mr-3">Status</span>
                      <span className={`font-medium text-right ${isRunning ? 'text-green-500' : 'text-muted-foreground'}`}>
                        {isRunning ? '\u25CF Running' : '\u25CB Stopped'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1.5 border-b text-xs">
                      <span className="text-muted-foreground shrink-0 mr-3">Model</span>
                      <span className="font-medium text-right">{p.model || '\u2014'}</span>
                    </div>
                    {p.alias && (
                      <div className="flex justify-between items-center py-1.5 border-b text-xs">
                        <span className="text-muted-foreground shrink-0 mr-3">Alias</span>
                        <span className="font-medium text-right">{p.alias}</span>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter>
                    <div className="flex gap-1.5 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/agents/${encodeURIComponent(p.name)}`)}
                      >
                        Open
                      </Button>
                      {!p.active && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetDefault(p.name)}
                        >
                          Set Default
                        </Button>
                      )}
                      {p.name !== 'default' && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteAgent(p.name)}
                        >
                          <RiDeleteBin6Line />
                          Delete
                        </Button>
                      )}
                    </div>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}

        {/* ── Create Agent Dialog ─────────────────────────────────────────── */}
        <Dialog open={showCreateModal} onOpenChange={(open) => { if (!open) setShowCreateModal(false); }}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Create Agent</DialogTitle>
              <DialogDescription>
                Create a new Hermes profile.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateSubmit}>
              <div className="flex flex-col gap-3 mb-4">
                <Input
                  type="text"
                  placeholder="Agent name (e.g. worker, analyst)"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  autoFocus
                />

                {createMode === 'clone' && (
                  <Input
                    type="text"
                    placeholder="Source profile (e.g. david)"
                    value={cloneSource}
                    onChange={(e) => setCloneSource(e.target.value)}
                  />
                )}

                {createError && (
                  <p className="text-destructive text-xs">{createError}</p>
                )}
              </div>

              <DialogFooter className="gap-2">
                <DialogClose
                  render={<Button variant="outline" />}
                >
                  Cancel
                </DialogClose>
                <Button
                  type="button"
                  variant={createMode === 'clone' ? 'outline' : 'outline'}
                  className={createMode === 'clone' ? 'border-primary text-primary' : ''}
                  onClick={() => setCreateMode(createMode === 'clone' ? null : 'clone')}
                >
                  {createMode === 'clone' ? (
                    <><RiCheckLine /> Clone From</>
                  ) : (
                    <><RiFileCopyLine /> Clone From...</>
                  )}
                </Button>
                <Button
                  type="submit"
                  disabled={createSubmitting}
                >
                  {createSubmitting ? (
                    'Creating...'
                  ) : createMode === 'clone' ? (
                    'Clone'
                  ) : (
                    'Create Fresh'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* ── Confirm Dialog ─────────────────────────────────────────────── */}
        <Dialog
          open={!!confirmDialog}
          onOpenChange={(open) => {
            if (!open) (window as any).__confirmCancel?.();
          }}
        >
          <DialogContent className="sm:max-w-[380px]">
            <DialogHeader>
              <DialogTitle>{confirmDialog?.title}</DialogTitle>
              <DialogDescription>
                {confirmDialog?.message}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => (window as any).__confirmCancel?.()}
              >
                Cancel
              </Button>
              <Button
                onClick={() => confirmDialog?.onConfirm()}
              >
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Toast ──────────────────────────────────────────────────────── */}
        {toast && (
          <div
            className={`fixed bottom-6 right-6 px-5 py-2.5 rounded-md text-xs font-medium z-[9999] shadow-lg text-white ${
              toast.type === 'success'
                ? 'bg-green-500'
                : toast.type === 'error'
                  ? 'bg-destructive'
                  : 'bg-primary'
            }`}
          >
            {toast.message}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
