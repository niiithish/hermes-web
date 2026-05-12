"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { api } from "@/app/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyMedia, EmptyDescription } from "@/components/ui/empty";
import {
  RiSendPlaneFill,
  RiAddLine,
  RiMessage2Line,
  RiCloseLine,
  RiHistoryLine,
  RiStopFill,
  RiMenuLine,
  RiArrowRightSLine,
  RiArrowDownSLine,
} from "@remixicon/react";

interface Session {
  id: string;
  title?: string;
  parent_session_id?: string;
  started_at?: number;
  ended_at?: number;
  message_count?: number;
  messageCount?: number;
  source?: string;
  model?: string;
  preview?: string;
  last_activity?: number;
  lastActive?: string;
  startedAt?: number;
  endedAt?: number;
}

interface Message {
  id?: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: number;
  token_count?: number;
  finish_reason?: string;
  reasoning?: string;
}

/** Parse <think>...</think> blocks out of assistant message content into separate reasoning field */
function extractThinking(msg: Message): Message {
  if (!msg.content || msg.role !== "assistant") return msg;
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  let match;
  const reasoningParts: string[] = [];
  while ((match = thinkRegex.exec(msg.content)) !== null) {
    if (match[1].trim()) reasoningParts.push(match[1].trim());
  }
  if (reasoningParts.length === 0) return msg;
  const cleanedContent = msg.content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
  return {
    ...msg,
    content: cleanedContent || msg.content,
    reasoning: msg.reasoning
      ? msg.reasoning + "\n" + reasoningParts.join("\n")
      : reasoningParts.join("\n"),
  };
}

export default function ChatPage() {
  // State
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [profiles, setProfiles] = useState<
    Array<{ name: string; active?: boolean }>
  >([]);
  const [selectedProfile, setSelectedProfile] = useState("default");
  const [title, setTitle] = useState("New Chat");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [expandedReasoning, setExpandedReasoning] = useState<Set<number>>(
    new Set(),
  );
  const [expandedTools, setExpandedTools] = useState<Set<number>>(
    new Set(),
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<AbortController | null>(null);
  const streamingMsgIndexRef = useRef<number | null>(null);
  const reasoningBufferRef = useRef("");
  // Batching: content tokens are buffered until we know whether reasoning is coming.
  // This prevents content from appearing first and then the Thinking section
  // popping in above it, which causes a jarring layout jump.
  const hasReasoningForMsgRef = useRef(false);
  const pendingContentRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
    loadProfiles();
  }, []);

  // Auto-scroll on new messages — instant snap, no smooth animation
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages]);

  // Restore last session from localStorage
  useEffect(() => {
    const lastSid = localStorage.getItem("hci-last-session");
    if (lastSid && sessions.length > 0) {
      const found = sessions.find((s) => s.id === lastSid);
      if (found) {
        loadSessionMessages(lastSid);
      } else {
        localStorage.removeItem("hci-last-session");
      }
    }
  }, [sessions]);

  const loadSessions = async (silent = false) => {
    try {
      if (!silent) setLoadingSessions(true);
      const data = await api.get<{ ok: boolean; sessions: Session[] }>(
        "/api/sessions",
      );
      if (data.ok) {
        setSessions(data.sessions || []);
        return data.sessions || [];
      }
      return [];
    } catch (err) {
      console.error("Failed to load sessions:", err);
      return [];
    } finally {
      if (!silent) setLoadingSessions(false);
    }
  };

  const loadProfiles = async () => {
    try {
      const data = await api.get<{
        ok: boolean;
        profiles: Array<{ name: string; active?: boolean }>;
      }>("/api/profiles");
      if (data.ok && data.profiles) {
        setProfiles(data.profiles);
        const active = data.profiles.find((p) => p.active);
        if (active) setSelectedProfile(active.name);
      }
    } catch {}
  };

  const loadSessionMessages = async (sessionId: string) => {
    try {
      setLoadingMessages(true);
      setCurrentSessionId(sessionId);
      setMessages([]);
      const data = await api.get<{
        ok: boolean;
        messages: Message[];
        session: Session;
      }>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
      if (data.ok) {
        // Parse thinking tags from stored messages
        const parsedMessages = (data.messages || []).map(extractThinking);
        setMessages(parsedMessages);
        // Title: prefer DB title, then first user message, then fallback
        const firstUserMsg = parsedMessages.find((m) => m.role === "user");
        const fallbackTitle = firstUserMsg?.content
          ? firstUserMsg.content.slice(0, 50) +
            (firstUserMsg.content.length > 50 ? "…" : "")
          : "Untitled Chat";
        setTitle(data.session?.title || fallbackTitle);
      }
      localStorage.setItem("hci-last-session", sessionId);
    } catch (err) {
      setError("Failed to load messages");
    } finally {
      setLoadingMessages(false);
    }
  };

  const newChatSession = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setTitle("New Chat");
    setExpandedReasoning(new Set());
    setStreaming(false);
    streamRef.current?.abort();
    streamRef.current = null;
  };

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this session?")) return;
    try {
      await api.del(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (currentSessionId === sessionId) newChatSession();
      loadSessions();
    } catch (err) {
      setError("Failed to delete session");
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setError("");

    const userMsg: Message = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const assistantMsg: Message = {
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    };
    const assistantIdx = messages.length + 1;
    streamingMsgIndexRef.current = assistantIdx;
    setMessages((prev) => [...prev, assistantMsg]);
    setStreaming(true);
    setElapsed(0);

    const elapsedTimer = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    try {
      const controller = new AbortController();
      streamRef.current = controller;

      const res = await api.chatSend({
        message: text,
        sessionId: currentSessionId || undefined,
        profile: selectedProfile,
      });

      if (!res.ok) {
        const errData = await res
          .json()
          .catch(() => ({ error: "Request failed" }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "reasoning") {
                // Reasoning has started — flush any buffered content now so both
                // appear together in the first paint of the bubble.
                hasReasoningForMsgRef.current = true;
                reasoningBufferRef.current += data.content || "";
                if (flushTimerRef.current) {
                  clearTimeout(flushTimerRef.current);
                  flushTimerRef.current = null;
                }
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  const last = updated[lastIdx];
                  if (last && last.role === "assistant") {
                    const pending = pendingContentRef.current;
                    pendingContentRef.current = "";
                    updated[lastIdx] = {
                      ...last,
                      reasoning:
                        (last.reasoning || "") + (data.content || ""),
                      content: pending ? last.content + pending : last.content,
                    };
                  }
                  return updated;
                });
              } else if (data.type === "token") {
                // Show content immediately — no buffering needed since Thinking
                // is no longer auto-expanded, so content won't jump when it appears.
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === "assistant") {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + (data.content || ""),
                    };
                  }
                  return updated;
                });
              } else if (data.type === "done") {
                if (data.sessionId) {
                  setCurrentSessionId(data.sessionId);
                  localStorage.setItem("hci-last-session", data.sessionId);
                  // Derive title from first user message (already in state)
                  setMessages((prev) => {
                    const firstUserMsg = prev.find((m) => m.role === "user");
                    if (firstUserMsg?.content) {
                      const t = firstUserMsg.content.slice(0, 50);
                      setTitle(t + (firstUserMsg.content.length > 50 ? "…" : ""));
                    }
                    return prev;
                  });
                  // Silently refresh sessions list in background (no re-render loop)
                  loadSessions(true);
                }
                // Flush any remaining pending content, apply buffered reasoning,
                // and parse <think> tags.
                if (flushTimerRef.current) {
                  clearTimeout(flushTimerRef.current);
                  flushTimerRef.current = null;
                }
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  const last = updated[lastIdx];
                  if (last && last.role === "assistant") {
                    let msg = { ...last };
                    if (reasoningBufferRef.current) {
                      msg.reasoning = reasoningBufferRef.current;
                    }
                    if (pendingContentRef.current) {
                      msg.content =
                        msg.content + pendingContentRef.current;
                      pendingContentRef.current = "";
                    }
                    msg = extractThinking(msg);
                    updated[lastIdx] = msg;
                  }
                  return updated;
                });
                reasoningBufferRef.current = "";
                hasReasoningForMsgRef.current = false;
              } else if (data.type === "error") {
                const errText = data.content || "Stream error";
                // Silently drop CLI bookkeeping noise that leaks as errors
                if (/session_id:/i.test(errText)) continue;
                setError(errText);
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Failed to send message");
      }
    } finally {
      clearInterval(elapsedTimer);
      setStreaming(false);
      streamRef.current = null;
      // Flush remaining buffered content (e.g. on abort / error)
      if (pendingContentRef.current) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content: last.content + pendingContentRef.current,
            };
            pendingContentRef.current = "";
          }
          return updated;
        });
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      // Reset streaming refs
      if (streamingMsgIndexRef.current !== null) {
        streamingMsgIndexRef.current = null;
      }
      reasoningBufferRef.current = "";
      hasReasoningForMsgRef.current = false;
    }
  };

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.abort();
      streamRef.current = null;
    }
    setStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const filteredSessions = sessions.filter((s) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (s.title?.toLowerCase().includes(q) ?? false) ||
      s.id.toLowerCase().includes(q)
    );
  });

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ── helpers ─────────────────────────────────────────────────────────────────

  /** Render message content with basic markdown-like formatting. */
  function renderContent(content: string) {
    if (!content) return "";
    // Escape HTML
    const escaped = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    // Code blocks
    let rendered = escaped.replace(
      /```(\w*)\n([\s\S]*?)```/g,
      '<pre><code class="language-$1">$2</code></pre>',
    );
    // Inline code
    rendered = rendered.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Bold
    rendered = rendered.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // Italic
    rendered = rendered.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    // Line breaks
    rendered = rendered.replace(/\n/g, "<br />");
    return rendered;
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      {sidebarOpen && (
        <>
          <div className="w-xs border-r bg-card flex flex-col shrink-0 h-full overflow-hidden">
            <div className="p-2.5 border-b flex flex-col gap-1.5 shrink-0">
              <div className="flex gap-1.5 items-center">
                <select
                  value={selectedProfile}
                  onChange={(e) => setSelectedProfile(e.target.value)}
                  className="flex-1 h-7 px-2 text-xs rounded-md border bg-muted/50 cursor-pointer"
                >
                  {profiles.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                      {p.active ? " *" : ""}
                    </option>
                  ))}
                  {profiles.length === 0 && (
                    <option value="default">default</option>
                  )}
                </select>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setSidebarOpen(false)}
                >
                  <RiCloseLine className="size-3" />
                </Button>
              </div>
              <Input
                type="search"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 text-xs"
              />
              <Button
                variant="default"
                size="sm"
                onClick={newChatSession}
                className="w-full"
              >
                <RiAddLine className="size-3.5" />
                New Chat
              </Button>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-1">
                {loadingSessions && (
                  <div className="flex items-center justify-center gap-2 p-4 text-muted-foreground text-xs">
                    <Spinner className="size-3.5" />
                    Loading sessions...
                  </div>
                )}
                {!loadingSessions && filteredSessions.length === 0 && (
                  <Empty>
                    <EmptyMedia variant="icon">
                      <RiHistoryLine className="size-4" />
                    </EmptyMedia>
                    <EmptyDescription>No sessions yet</EmptyDescription>
                  </Empty>
                )}
                {filteredSessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => loadSessionMessages(session.id)}
                    className={cn(
                      "px-2.5 py-2 cursor-pointer rounded-md mb-0.5 transition-colors",
                      currentSessionId === session.id
                        ? "bg-primary/10 border border-primary"
                        : "bg-transparent border border-transparent hover:bg-muted",
                    )}
                  >
                    <div className="flex justify-between items-start">
                      <div className="text-xs font-medium flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                        {session.title || session.id.slice(0, 16)}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(e) => deleteSession(session.id, e)}
                        className="opacity-40 hover:opacity-100 -mr-1"
                      >
                        <RiCloseLine className="size-2.5" />
                      </Button>
                    </div>
                    {session.preview && (
                      <div className="text-[11px] text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap mt-0.5">
                        {session.preview}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {session.messageCount || session.message_count || 0} msgs
                      {(session.startedAt || session.started_at) &&
                        ` * ${formatDate(session.startedAt || session.started_at!)}`}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        </>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setSidebarOpen(true)}
              >
                <RiMenuLine className="size-3.5" />
              </Button>
            )}
            <div className="text-sm font-medium">{title}</div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {loadingMessages && (
            <div className="flex items-center justify-center gap-2 p-4 text-muted-foreground text-xs">
              <Spinner className="size-3.5" />
              Loading messages...
            </div>
          )}
          {!loadingMessages && messages.length === 0 && !streaming && (
            <Empty>
              <EmptyMedia variant="icon">
                <RiMessage2Line className="size-4" />
              </EmptyMedia>
              <EmptyDescription>
                Start a conversation with your Hermes agent
              </EmptyDescription>
            </Empty>
          )}
          {/* Pre-process: attach tool messages to the following non-tool message */}
          {(() => {
            const processedMessages: Array<{
              msg: Message;
              toolCalls: Array<{ msg: Message; originalIdx: number }>;
              originalIdx: number;
            }> = [];

            let pendingTools: Array<{ msg: Message; originalIdx: number }> = [];

            messages.forEach((m, i) => {
              if (m.role === "tool") {
                pendingTools.push({ msg: m, originalIdx: i });
              } else {
                processedMessages.push({
                  msg: m,
                  toolCalls: [...pendingTools],
                  originalIdx: i,
                });
                pendingTools = [];
              }
            });

            // Attach any trailing tool messages to the last processed message
            if (pendingTools.length > 0 && processedMessages.length > 0) {
              const last = processedMessages[processedMessages.length - 1];
              last.toolCalls.push(...pendingTools);
            }

            return processedMessages;
          })().map(({ msg, toolCalls, originalIdx }) => {
            const isStreaming = streaming && originalIdx === messages.length - 1;
            return (
              <div
                key={originalIdx}
                className={cn(
                  "flex flex-col max-w-[85%]",
                  msg.role === "user"
                    ? "items-end self-end"
                    : "items-start self-start",
                )}
              >
                {/* Show bubble if there's content or reasoning */}
                {(msg.content || msg.reasoning || isStreaming) && (
                  <div
                    className={cn(
                      "leading-relaxed break-words",
                      msg.role === "user" &&
                        "px-3.5 py-2 rounded-lg border text-sm bg-primary/10 border-primary",
                      msg.role !== "user" &&
                        "px-3.5 py-2 rounded-lg border text-sm bg-card border-border",
                    )}
                  >
                    {/* Content — strip partial <think> blocks during streaming so
                        literal thinking tags don't flash before they're extracted. */}
                    {msg.content && (() => {
                      // During streaming, strip incomplete <think> blocks from display
                      // so the raw XML doesn't flicker before extractThinking runs at done.
                      const display = isStreaming
                        ? msg.content
                            .replace(/<think>[\s\S]*?<\/think>/g, "")
                            .replace(/<think>[\s\S]*$/, "")
                            .trim()
                        : msg.content;
                      if (!display) return null;
                      return (
                        <div
                          dangerouslySetInnerHTML={{
                            __html: renderContent(display),
                          }}
                        />
                      );
                    })()}
                  </div>
                )}

                {/* Tool calls — attached to this message, shown below bubble */}
                {toolCalls.length > 0 && toolCalls.map(({ msg: toolMsg, originalIdx: toolIdx }) => (
                  <div key={toolIdx} className="mt-1">
                    <button
                      onClick={() =>
                        setExpandedTools((prev) => {
                          const next = new Set(prev);
                          if (next.has(toolIdx)) next.delete(toolIdx);
                          else next.add(toolIdx);
                          return next;
                        })
                      }
                      className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer select-none flex items-center gap-0.5 font-mono"
                    >
                      {expandedTools.has(toolIdx) ? (
                        <RiArrowDownSLine className="size-3.5" />
                      ) : (
                        <RiArrowRightSLine className="size-3.5" />
                      )}
                      tool call
                    </button>
                    {expandedTools.has(toolIdx) && (
                      <div className="mt-1 text-[11px] text-muted-foreground/70 font-mono whitespace-pre-wrap break-words border-l-2 border-muted-foreground/10 pl-2">
                        {toolMsg.content}
                      </div>
                    )}
                  </div>
                ))}

                {/* Thinking — shown below the message bubble, collapsed by default */}
                {msg.role !== "user" && msg.reasoning && (
                  <div className="mt-1">
                    <button
                      onClick={() =>
                        setExpandedReasoning((prev) => {
                          const next = new Set(prev);
                          if (next.has(originalIdx)) next.delete(originalIdx);
                          else next.add(originalIdx);
                          return next;
                        })
                      }
                      className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer select-none flex items-center gap-0.5 font-mono"
                    >
                      {expandedReasoning.has(originalIdx) ? (
                        <RiArrowDownSLine className="size-3.5" />
                      ) : (
                        <RiArrowRightSLine className="size-3.5" />
                      )}
                      thinking
                    </button>
                    {expandedReasoning.has(originalIdx) && (
                      <div className="mt-1 text-[11px] text-muted-foreground/70 font-mono whitespace-pre-wrap break-words border-l-2 border-muted-foreground/10 pl-2">
                        {msg.reasoning}
                      </div>
                    )}
                  </div>
                )}

                {msg.token_count && msg.role === "assistant" && (
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {msg.token_count} tokens
                  </div>
                )}
                {/* Inline streaming status for the last message */}
                {isStreaming && (
                  <div className="flex items-center gap-1.5 text-muted-foreground text-xs mt-1">
                    <span className="inline-block size-2 rounded-full bg-primary animate-pulse" />
                    Streaming... ({formatTime(elapsed)})
                  </div>
                )}
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div className="px-4 py-2 text-destructive text-xs bg-destructive/10 border-t border-border">
            {error}
          </div>
        )}

        {/* Input area */}
        <div className="p-2.5 px-4 border-t bg-card flex gap-2 items-stretch">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send)"
            rows={1}
            className="flex-1 min-h-9 max-h-[120px]"
          />
          {streaming ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={stopStream}
              className="h-auto"
            >
              <RiStopFill className="size-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={sendMessage}
              disabled={!input.trim()}
              className="h-auto"
            >
              <RiSendPlaneFill className="size-3.5" />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
