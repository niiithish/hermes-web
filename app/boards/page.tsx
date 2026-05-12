'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/app/lib/api-client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  RiAddLine,
  RiRefreshLine,
  RiDeleteBin6Line,
  RiUser3Line,
  RiMessage2Line,
} from '@remixicon/react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KanbanTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
  priority: number;
  priority_label?: string;
  tenant: string | null;
  workspace_kind: string;
  workspace_path: string | null;
  created_by: string | null;
  created_at: number; // Unix timestamp (seconds)
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  skills: string[];
  max_retries: number | null;
}

interface KanbanColumn {
  id: string;
  label: string;
  tasks: KanbanTask[];
}

interface BoardInfo {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  created_at: number | null;
  archived: boolean;
  db_path: string;
  is_current: boolean;
  counts: Record<string, number>;
  total: number;
}

interface TaskComment {
  author: string;
  body: string;
  created_at: number; // Unix timestamp
}

interface TaskEvent {
  kind: string;
  payload: Record<string, unknown>;
  created_at: number;
  run_id: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<number, string> = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high', 4: 'critical' };

const PRIORITY_COLORS: Record<string, string> = {
  '1': 'bg-green-500',
  '2': 'bg-yellow-500',
  '3': 'bg-orange-500',
  '4': 'bg-red-500',
};

const COLUMN_COLORS: Record<string, string> = {
  triage: 'border-t-gray-400',
  todo: 'border-t-stone-400',
  ready: 'border-t-blue-400',
  running: 'border-t-amber-400',
  blocked: 'border-t-red-400',
  done: 'border-t-green-500',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number | null) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(ts: number | null) {
  if (!ts) return '';
  const diff = Date.now() - ts * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function priorityDisplay(priority: number) {
  return PRIORITY_LABELS[priority] || String(priority);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BoardsPage() {
  // Board state
  const [activeBoardSlug, setActiveBoardSlug] = useState<string>('default');

  // Data state
  const [columns, setColumns] = useState<KanbanColumn[]>([
    { id: 'triage', label: 'Triage', tasks: [] },
    { id: 'todo', label: 'Todo', tasks: [] },
    { id: 'ready', label: 'Ready', tasks: [] },
    { id: 'running', label: 'Running', tasks: [] },
    { id: 'blocked', label: 'Blocked', tasks: [] },
    { id: 'done', label: 'Done', tasks: [] },
  ]);
  const [boards, setBoards] = useState<BoardInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drag state
  const [draggedTask, setDraggedTask] = useState<KanbanTask | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Create task dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createBody, setCreateBody] = useState('');
  const [createPriority, setCreatePriority] = useState('none');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Task detail dialog
  const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null);
  const [taskDetail, setTaskDetail] = useState<{
    parents: unknown[];
    children: unknown[];
    comments: TaskComment[];
    events: TaskEvent[];
    runs: unknown[];
  } | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [newComment, setNewComment] = useState('');

  // New board dialog
  const [showBoardDialog, setShowBoardDialog] = useState(false);
  const [newBoardSlug, setNewBoardSlug] = useState('');

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // ── Load board ──────────────────────────────────────────────────────────

  const loadBoard = useCallback(async (boardSlug?: string) => {
    const slug = boardSlug ?? activeBoardSlug;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{
        ok: boolean;
        columns: KanbanColumn[];
        boards: BoardInfo[];
        activeBoard: BoardInfo | null;
        error?: string;
      }>(`/api/kanban/board?board=${encodeURIComponent(slug)}`);
      if (res.ok) {
        setColumns(res.columns || [
          { id: 'triage', label: 'Triage', tasks: [] },
          { id: 'todo', label: 'Todo', tasks: [] },
          { id: 'ready', label: 'Ready', tasks: [] },
          { id: 'running', label: 'Running', tasks: [] },
          { id: 'blocked', label: 'Blocked', tasks: [] },
          { id: 'done', label: 'Done', tasks: [] },
        ]);
        setBoards(res.boards || []);
        // Keep current active board slug in sync
        if (res.activeBoard) {
          setActiveBoardSlug(res.activeBoard.slug);
        }
      } else {
        setError(res.error || 'Failed to load board');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load board');
    } finally {
      setLoading(false);
    }
  }, [activeBoardSlug]);

  useEffect(() => {
    loadBoard();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toast helper ────────────────────────────────────────────────────────

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Drag & Drop ─────────────────────────────────────────────────────────

  const handleDragStart = useCallback((task: KanbanTask) => {
    setDraggedTask(task);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, statusId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(statusId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(async (statusId: string) => {
    setDropTarget(null);
    if (!draggedTask) return;
    if (draggedTask.status === statusId) return;

    const task = draggedTask;
    const oldStatus = task.status;
    setDraggedTask(null);

    // Optimistic update
    setColumns(prev => prev.map(col => {
      if (col.id === oldStatus) {
        return { ...col, tasks: col.tasks.filter(t => t.id !== task.id) };
      }
      if (col.id === statusId) {
        return { ...col, tasks: [...col.tasks, { ...task, status: statusId }] };
      }
      return col;
    }));

    // Persist to server
    try {
      const res = await api.patch<{ ok: boolean; error?: string }>(
        `/api/kanban/tasks/${task.id}?board=${encodeURIComponent(activeBoardSlug)}`,
        { status: statusId }
      );
      if (res.ok) {
        showToast(`Moved "${task.title}" to ${columns.find(c => c.id === statusId)?.label}`, 'success');
      } else {
        showToast(res.error || 'Failed to update task', 'error');
        loadBoard();
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to update task', 'error');
      loadBoard();
    }
  }, [draggedTask, columns, activeBoardSlug, loadBoard, showToast]);

  // ── Create task ─────────────────────────────────────────────────────────

  const handleCreateTask = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createTitle.trim() || createSubmitting) return;

    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const res = await api.post<{ ok: boolean; task?: KanbanTask; error?: string }>('/api/kanban/tasks', {
        title: createTitle.trim(),
        body: createBody.trim() || undefined,
        priority: createPriority,
        board: activeBoardSlug,
      });
      if (res.ok) {
        setShowCreateDialog(false);
        setCreateTitle('');
        setCreateBody('');
        setCreatePriority('none');
        showToast('Task created', 'success');
        loadBoard();
      } else {
        setCreateError(res.error || 'Failed to create task');
      }
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create task');
    } finally {
      setCreateSubmitting(false);
    }
  }, [createTitle, createBody, createPriority, activeBoardSlug, createSubmitting, loadBoard, showToast]);

  // ── View task detail ────────────────────────────────────────────────────

  const handleOpenDetail = useCallback(async (task: KanbanTask) => {
    setSelectedTask(task);
    setTaskDetail(null);
    setShowDetailDialog(true);
    setDetailLoading(true);
    try {
      const res = await api.get<{
        ok: boolean;
        task: KanbanTask;
        parents: unknown[];
        children: unknown[];
        comments: TaskComment[];
        events: TaskEvent[];
        runs: unknown[];
      }>(`/api/kanban/tasks/${task.id}?board=${encodeURIComponent(activeBoardSlug)}`);
      if (res.ok) {
        setSelectedTask(res.task);
        setTaskDetail({
          parents: res.parents,
          children: res.children,
          comments: res.comments,
          events: res.events,
          runs: res.runs,
        });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load task', 'error');
    } finally {
      setDetailLoading(false);
    }
  }, [activeBoardSlug, showToast]);

  // ── Update task in detail view ──────────────────────────────────────────

  const handleUpdateTaskField = useCallback(async (field: string, value: string | null) => {
    if (!selectedTask) return;
    try {
      const res = await api.patch<{ ok: boolean; task: KanbanTask; priority_label?: string }>(
        `/api/kanban/tasks/${selectedTask.id}?board=${encodeURIComponent(activeBoardSlug)}`,
        { [field]: value }
      );
      if (res.ok) {
        setSelectedTask(res.task);
        loadBoard();
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to update', 'error');
    }
  }, [selectedTask, activeBoardSlug, loadBoard, showToast]);

  // ── Add comment ─────────────────────────────────────────────────────────

  const handleAddComment = useCallback(async () => {
    if (!selectedTask || !newComment.trim()) return;
    try {
      const res = await api.post<{ ok: boolean; error?: string }>(
        `/api/kanban/tasks/${selectedTask.id}/comments?board=${encodeURIComponent(activeBoardSlug)}`,
        { body: newComment.trim() }
      );
      if (res.ok) {
        setNewComment('');
        // Refresh task detail
        const detailRes = await api.get<{
          ok: boolean;
          task: KanbanTask;
          comments: TaskComment[];
          events: TaskEvent[];
          runs: unknown[];
        }>(`/api/kanban/tasks/${selectedTask.id}?board=${encodeURIComponent(activeBoardSlug)}`);
        if (detailRes.ok) {
          setSelectedTask(detailRes.task);
          setTaskDetail({
            parents: [],
            children: [],
            comments: detailRes.comments,
            events: detailRes.events,
            runs: detailRes.runs,
          });
        }
        showToast('Comment added', 'success');
      } else {
        showToast(res.error || 'Failed to add comment', 'error');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to add comment', 'error');
    }
  }, [selectedTask, newComment, activeBoardSlug, showToast]);

  // ── Delete task ─────────────────────────────────────────────────────────

  const handleDeleteTask = useCallback(async () => {
    if (!selectedTask) return;
    try {
      const res = await api.del<{ ok: boolean; error?: string }>(
        `/api/kanban/tasks/${selectedTask.id}?board=${encodeURIComponent(activeBoardSlug)}`
      );
      if (res.ok) {
        setShowDetailDialog(false);
        setSelectedTask(null);
        showToast('Task archived', 'success');
        loadBoard();
      } else {
        showToast(res.error || 'Failed to archive task', 'error');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to delete', 'error');
    }
  }, [selectedTask, activeBoardSlug, loadBoard, showToast]);

  // ── Create board ────────────────────────────────────────────────────────

  const handleCreateBoard = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBoardSlug.trim()) return;
    try {
      const res = await api.post<{ ok: boolean; error?: string }>('/api/kanban/boards', {
        slug: newBoardSlug.trim(),
      });
      if (res.ok) {
        setShowBoardDialog(false);
        setNewBoardSlug('');
        showToast('Board created', 'success');
        loadBoard();
      } else {
        showToast(res.error || 'Failed to create board', 'error');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to create board', 'error');
    }
  }, [newBoardSlug, loadBoard, showToast]);

  // ── Switch board ────────────────────────────────────────────────────────

  const handleSwitchBoard = useCallback(async (slug: string) => {
    if (!slug || slug === activeBoardSlug) return;
    try {
      // Switch active board on the CLI side
      await api.post(`/api/kanban/boards/${slug}/switch`);
      // Load data for the new board
      setActiveBoardSlug(slug);
      loadBoard(slug);
      showToast(`Switched to ${slug}`, 'info');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to switch board', 'error');
    }
  }, [activeBoardSlug, loadBoard, showToast]);

  // ── Total task count ────────────────────────────────────────────────────

  const totalTasks = columns.reduce((sum, col) => sum + col.tasks.length, 0);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold uppercase tracking-wider">Kanban Board</h1>
          <Badge variant="outline" className="text-xs">
            {activeBoardSlug}
          </Badge>
          <span className="text-xs text-muted-foreground">{totalTasks} tasks</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Board selector */}
          {boards.length > 1 && (
            <Select value={activeBoardSlug} onValueChange={(v) => v && handleSwitchBoard(v)}>
              <SelectTrigger className="h-7 text-xs w-[150px]">
                <SelectValue placeholder="Select board" />
              </SelectTrigger>
              <SelectContent>
                {boards.map(b => (
                  <SelectItem key={b.slug} value={b.slug} className="text-xs">
                    {b.name || b.slug}
                    {b.is_current ? ' \u2713' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {boards.length <= 1 && (
            <span className="text-xs text-muted-foreground italic">Default board</span>
          )}

          <Button variant="ghost" size="sm" onClick={() => setShowBoardDialog(true)} className="text-xs h-7">
            + Board
          </Button>

          <Button variant="ghost" size="icon-sm" onClick={() => loadBoard()}>
            <RiRefreshLine />
          </Button>

          <Button size="sm" onClick={() => setShowCreateDialog(true)} className="text-xs h-7">
            <RiAddLine />
            New Task
          </Button>
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="px-4 py-2 text-xs text-destructive bg-destructive/5 border-b">{error}</div>
      )}

      {/* ── Board ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Spinner />
          <span className="ml-2 text-muted-foreground text-sm">Loading board...</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="grid grid-cols-3 grid-rows-2 gap-3 p-3 h-full">
            {columns.map(col => (
              <div
                key={col.id}
                className={`flex flex-col border rounded-lg bg-muted/20 min-h-0
                  ${dropTarget === col.id ? 'ring-2 ring-primary/50 bg-primary/5' : ''}
                  ${COLUMN_COLORS[col.id] || ''} border-t-[3px]`}
                onDragOver={(e) => handleDragOver(e, col.id)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(col.id)}
              >
                {/* Column header */}
                <div className="flex items-center justify-between px-3 py-2 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                      {col.label}
                    </span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                      {col.tasks.length}
                    </Badge>
                  </div>
                </div>

                {/* Column tasks */}
                <ScrollArea className="flex-1 px-2 pb-2">
                  <div className="flex flex-col gap-2">
                    {col.tasks.map(task => (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={() => handleDragStart(task)}
                        onClick={() => handleOpenDetail(task)}
                        className={`bg-card border rounded-md p-2.5 cursor-pointer hover:border-primary/50
                          hover:shadow-sm transition-all ${
                          draggedTask?.id === task.id ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1 mb-1.5">
                          <span className="text-xs font-medium leading-tight line-clamp-2">
                            {task.title}
                          </span>
                          {task.priority > 0 && (
                            <span
                              className={`shrink-0 size-2 rounded-full mt-1 ${
                                PRIORITY_COLORS[String(task.priority)] || 'bg-muted-foreground'
                              }`}
                              title={`Priority: ${priorityDisplay(task.priority)}`}
                            />
                          )}
                        </div>

                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {task.assignee && (
                              <span className="flex items-center gap-0.5">
                                <RiUser3Line className="size-2.5" />
                                {task.assignee}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {timeAgo(task.created_at)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Create Task Dialog ─────────────────────────────────────────────── */}
      <Dialog open={showCreateDialog} onOpenChange={(open) => { if (!open) { setShowCreateDialog(false); setCreateError(null); } }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
            <DialogDescription>
              Add a new task to <strong>{activeBoardSlug}</strong>.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateTask}>
            <div className="flex flex-col gap-3 mb-4">
              <Input
                placeholder="Task title"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                autoFocus
              />
              <Textarea
                placeholder="Description (optional)"
                value={createBody}
                onChange={(e) => setCreateBody(e.target.value)}
                rows={3}
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground w-16 shrink-0">Priority</label>
                <Select value={createPriority} onValueChange={(v) => v && setCreatePriority(v)}>
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">None</SelectItem>
                    <SelectItem value="low" className="text-xs">Low</SelectItem>
                    <SelectItem value="medium" className="text-xs">Medium</SelectItem>
                    <SelectItem value="high" className="text-xs">High</SelectItem>
                    <SelectItem value="critical" className="text-xs">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {createError && <p className="text-destructive text-xs">{createError}</p>}
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button type="submit" disabled={createSubmitting || !createTitle.trim()}>
                {createSubmitting ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Task Detail Dialog ─────────────────────────────────────────────── */}
      <Dialog open={showDetailDialog} onOpenChange={(open) => { if (!open) { setShowDetailDialog(false); setSelectedTask(null); } }}>
        <DialogContent className="sm:max-w-[540px] max-h-[80vh] flex flex-col">
          {selectedTask && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{selectedTask.title}</DialogTitle>
                <DialogDescription className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">{selectedTask.status.replace(/_/g, ' ')}</Badge>
                  {selectedTask.priority > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      Priority: {priorityDisplay(selectedTask.priority)}
                    </Badge>
                  )}
                  {selectedTask.assignee && (
                    <Badge variant="outline" className="text-[10px]">
                      <RiUser3Line className="size-2.5 mr-0.5" />
                      {selectedTask.assignee}
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground">ID: {selectedTask.id}</span>
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-auto space-y-4">
                {/* Quick actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={selectedTask.status} onValueChange={(v) => v && handleUpdateTaskField('status', v)}>
                    <SelectTrigger className="h-7 text-xs w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="triage" className="text-xs">Triage</SelectItem>
                      <SelectItem value="todo" className="text-xs">Todo</SelectItem>
                      <SelectItem value="ready" className="text-xs">Ready</SelectItem>
                      <SelectItem value="running" className="text-xs">Running</SelectItem>
                      <SelectItem value="blocked" className="text-xs">Blocked</SelectItem>
                      <SelectItem value="done" className="text-xs">Done</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={priorityDisplay(selectedTask.priority)}
                    onValueChange={(v) => v && handleUpdateTaskField('priority', v)}
                  >
                    <SelectTrigger className="h-7 text-xs w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-xs">No priority</SelectItem>
                      <SelectItem value="low" className="text-xs">Low</SelectItem>
                      <SelectItem value="medium" className="text-xs">Medium</SelectItem>
                      <SelectItem value="high" className="text-xs">High</SelectItem>
                      <SelectItem value="critical" className="text-xs">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Description */}
                {selectedTask.body && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-1">Description</h4>
                    <p className="text-sm whitespace-pre-wrap border rounded-md p-3 bg-muted/20">
                      {selectedTask.body}
                    </p>
                  </div>
                )}

                {/* Parents / Depends on */}
                {taskDetail?.parents && taskDetail.parents.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-1">Depends On</h4>
                    <div className="flex flex-wrap gap-1">
                      {(taskDetail.parents as { id: string; title: string }[]).map((p, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">
                          {p.title || p.id}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Children / Blocks */}
                {taskDetail?.children && taskDetail.children.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-1">Blocks</h4>
                    <div className="flex flex-wrap gap-1">
                      {(taskDetail.children as { id: string; title: string }[]).map((c, i) => (
                        <Badge key={i} variant="outline" className="text-[10px]">
                          {c.title || c.id}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Timeline */}
                <div className="text-[10px] text-muted-foreground space-y-0.5">
                  <div>Created: {formatDate(selectedTask.created_at)}</div>
                  {selectedTask.started_at && <div>Started: {formatDate(selectedTask.started_at)}</div>}
                  {selectedTask.completed_at && <div>Completed: {formatDate(selectedTask.completed_at)}</div>}
                </div>

                {/* Events */}
                {detailLoading ? (
                  <div className="flex items-center gap-2 py-2">
                    <Spinner />
                    <span className="text-xs text-muted-foreground">Loading...</span>
                  </div>
                ) : (
                  <>
                    {taskDetail?.events && taskDetail.events.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground mb-1">Activity</h4>
                        <div className="space-y-1">
                          {taskDetail.events.map((ev, i) => (
                            <div key={i} className="text-xs flex gap-2 py-0.5">
                              <Badge variant="outline" className="text-[9px] h-4">{ev.kind}</Badge>
                              <span className="text-muted-foreground">
                                {JSON.stringify(ev.payload)}
                              </span>
                              <span className="text-muted-foreground ml-auto shrink-0">{timeAgo(ev.created_at)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Comments */}
                    {taskDetail?.comments && taskDetail.comments.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground mb-1">Comments</h4>
                        <div className="space-y-2">
                          {taskDetail.comments.map((c, i) => (
                            <div key={i} className="border rounded-md p-2.5 bg-muted/10">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] font-medium">{c.author}</span>
                              </div>
                              <p className="text-xs whitespace-pre-wrap">{c.body}</p>
                              <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(c.created_at)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Add comment */}
                <div className="flex gap-2 pt-1">
                  <Input
                    placeholder="Add a comment..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                    className="text-xs h-7"
                  />
                  <Button size="sm" onClick={handleAddComment} disabled={!newComment.trim()} className="text-xs h-7">
                    Post
                  </Button>
                </div>
              </div>

              <DialogFooter className="mt-3 gap-2">
                <Button variant="destructive" size="sm" onClick={handleDeleteTask} className="text-xs">
                  <RiDeleteBin6Line />
                  Archive
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── New Board Dialog ────────────────────────────────────────────────── */}
      <Dialog open={showBoardDialog} onOpenChange={(open) => { if (!open) setShowBoardDialog(false); }}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Create Board</DialogTitle>
            <DialogDescription>Create a new kanban board. The slug forms part of the database path.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateBoard}>
            <div className="flex flex-col gap-3 mb-4">
              <Input
                placeholder="Board slug (e.g. project-alpha)"
                value={newBoardSlug}
                onChange={(e) => setNewBoardSlug(e.target.value)}
                autoFocus
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button type="submit" disabled={!newBoardSlug.trim()}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-5 py-2.5 rounded-md text-xs font-medium z-[9999] shadow-lg text-white ${
          toast.type === 'success' ? 'bg-green-500' :
          toast.type === 'error' ? 'bg-destructive' : 'bg-primary'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}