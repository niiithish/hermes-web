'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/app/lib/api-client';

interface Session {
  id: string;
  title?: string;
  parent_session_id?: string;
  started_at: number;
  ended_at?: number;
  message_count: number;
  source?: string;
  model?: string;
  preview?: string;
  last_activity?: number;
}

interface Message {
  id?: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: number;
  token_count?: number;
  finish_reason?: string;
  reasoning?: string;
}

/** Parse <think>...</think> blocks out of assistant message content into separate reasoning field */
function extractThinking(msg: Message): Message {
  if (!msg.content || msg.role !== 'assistant') return msg;
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  let match;
  const reasoningParts: string[] = [];
  while ((match = thinkRegex.exec(msg.content)) !== null) {
    if (match[1].trim()) reasoningParts.push(match[1].trim());
  }
  if (reasoningParts.length === 0) return msg;
  const cleanedContent = msg.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return {
    ...msg,
    content: cleanedContent || msg.content,
    reasoning: msg.reasoning
      ? msg.reasoning + '\n' + reasoningParts.join('\n')
      : reasoningParts.join('\n'),
  };
}

export default function ChatPage() {
  // State
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [profiles, setProfiles] = useState<Array<{ name: string; active?: boolean }>>([]);
  const [selectedProfile, setSelectedProfile] = useState('default');
  const [title, setTitle] = useState('New Chat');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<AbortController | null>(null);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
    loadProfiles();
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Restore last session from localStorage
  useEffect(() => {
    const lastSid = localStorage.getItem('hci-last-session');
    if (lastSid && sessions.length > 0) {
      const found = sessions.find((s) => s.id === lastSid);
      if (found) {
        loadSessionMessages(lastSid);
      } else {
        localStorage.removeItem('hci-last-session');
      }
    }
  }, [sessions]);

  const loadSessions = async () => {
    try {
      setLoadingSessions(true);
      const data = await api.get<{ ok: boolean; sessions: Session[] }>('/api/sessions');
      if (data.ok) setSessions(data.sessions || []);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoadingSessions(false);
    }
  };

  const loadProfiles = async () => {
    try {
      const data = await api.get<{ ok: boolean; profiles: Array<{ name: string; active?: boolean }> }>('/api/profiles');
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
      const data = await api.get<{ ok: boolean; messages: Message[]; session: Session }>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
      if (data.ok) {
        // Parse thinking tags from stored messages
        setMessages((data.messages || []).map(extractThinking));
        setTitle(data.session?.title || sessionId);
      }
      localStorage.setItem('hci-last-session', sessionId);
    } catch (err) {
      setError('Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  };

  const newChatSession = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setTitle('New Chat');
    localStorage.removeItem('hci-last-session');
    if (inputRef.current) inputRef.current.focus();
  };

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this session?')) return;
    try {
      await api.del(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (currentSessionId === sessionId) newChatSession();
      loadSessions();
    } catch (err) {
      setError('Failed to delete session');
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setError('');

    const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    const assistantMsg: Message = { role: 'assistant', content: '', timestamp: Date.now() };
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
        const errData = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'reasoning') {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant') {
                    updated[updated.length - 1] = {
                      ...last,
                      reasoning: (last.reasoning || '') + (data.content || ''),
                    };
                  }
                  return updated;
                });
              } else if (data.type === 'token') {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant') {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + (data.content || ''),
                    };
                  }
                  return updated;
                });
              } else if (data.type === 'done') {
                if (data.sessionId) {
                  setCurrentSessionId(data.sessionId);
                  localStorage.setItem('hci-last-session', data.sessionId);
                  loadSessions();
                }
                // Post-stream: parse any remaining <think> tags from assistant messages
                setMessages((prev) => prev.map(extractThinking));
              } else if (data.type === 'error') {
                setError(data.content || 'Stream error');
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Failed to send message');
      }
    } finally {
      clearInterval(elapsedTimer);
      setStreaming(false);
      streamRef.current = null;
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
    if (e.key === 'Enter' && !e.shiftKey) {
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
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // Render message content with basic formatting
  const renderContent = (content: string) => {
    if (!content) return '';
    // Escape HTML
    const escaped = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Code blocks
    let rendered = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    // Inline code
    rendered = rendered.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    rendered = rendered.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    rendered = rendered.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Line breaks
    rendered = rendered.replace(/\n/g, '<br />');
    return rendered;
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Sidebar */}
      {sidebarOpen && (
        <>
          <div
            style={{
              width: '280px',
              borderRight: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-panel)',
              flexShrink: 0,
            }}
          >
            <div style={{ padding: '10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <select
                  value={selectedProfile}
                  onChange={(e) => setSelectedProfile(e.target.value)}
                  style={{ flex: 1, padding: '4px 8px', fontSize: '12px' }}
                >
                  {profiles.map((p) => (
                    <option key={p.name} value={p.name}>{p.name}{p.active ? ' ★' : ''}</option>
                  ))}
                  {profiles.length === 0 && <option value="default">default</option>}
                </select>
                <button
                  onClick={() => setSidebarOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--fg-muted)',
                    cursor: 'pointer',
                    fontSize: '14px',
                    padding: '2px',
                  }}
                >
                  ✕
                </button>
              </div>
              <input
                type="search"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={newChatSession}
                style={{ width: '100%' }}
              >
                + New Chat
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
              {loadingSessions && <div className="loading">Loading sessions...</div>}
              {!loadingSessions && filteredSessions.length === 0 && (
                <div className="empty">No sessions yet</div>
              )}
              {filteredSessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => loadSessionMessages(session.id)}
                  style={{
                    padding: '8px 10px',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius)',
                    marginBottom: '2px',
                    background: currentSessionId === session.id ? 'var(--accent-dim)' : 'transparent',
                    border: `1px solid ${currentSessionId === session.id ? 'var(--accent)' : 'transparent'}`,
                    transition: 'all var(--transition)',
                  }}
                  onMouseEnter={(e) => {
                    if (currentSessionId !== session.id) e.currentTarget.style.background = 'var(--bg-panel-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (currentSessionId !== session.id) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.title || session.id.slice(0, 16)}
                    </div>
                    <button
                      onClick={(e) => deleteSession(session.id, e)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--fg-muted)',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: '2px 4px',
                        opacity: 0.5,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  {session.preview && (
                    <div style={{
                      fontSize: '11px',
                      color: 'var(--fg-subtle)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginTop: '2px',
                    }}>
                      {session.preview}
                    </div>
                  )}
                  <div style={{ fontSize: '10px', color: 'var(--fg-subtle)', marginTop: '2px' }}>
                    {session.message_count} msgs
                    {session.started_at && ` · ${formatDate(session.started_at)}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Mobile backdrop */}
          <div
            style={{ display: 'none' }}
            className="chat-sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
          />
        </>
      )}

      {/* Main chat area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-panel)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="icon-btn"
                style={{ fontSize: '14px', padding: '4px 8px' }}
              >
                ☰
              </button>
            )}
            <div>
              <div style={{ fontSize: '14px', fontWeight: 500 }}>{title}</div>
              <div style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>
                {streaming ? 'Streaming...' : currentSessionId ? currentSessionId.slice(0, 20) : 'No session'}
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          {loadingMessages && <div className="loading">Loading messages...</div>}
          {!loadingMessages && messages.length === 0 && !streaming && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--fg-muted)',
            }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>💬</div>
              <div>Start a conversation with your Hermes agent</div>
            </div>
          )}
          {messages.map((msg, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-lg)',
                  background: msg.role === 'user' ? 'var(--accent-dim)' : 'var(--bg-panel)',
                  border: `1px solid ${msg.role === 'user' ? 'var(--accent)' : 'var(--border)'}`,
                  color: 'var(--fg)',
                  fontSize: '13px',
                  lineHeight: '1.6',
                  wordBreak: 'break-word',
                }}
                dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }}
              />
              {msg.reasoning && (
                <div style={{
                  marginTop: '4px',
                  padding: '6px 10px',
                  fontSize: '11px',
                  color: 'var(--fg-muted)',
                  background: 'var(--bg-input)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  maxWidth: '100%',
                }}>
                  <div style={{ fontWeight: 500, marginBottom: '2px', fontSize: '10px', color: 'var(--amber)' }}>
                    Reasoning
                  </div>
                  <div>{msg.reasoning}</div>
                </div>
              )}
              {msg.token_count && msg.role === 'assistant' && (
                <div style={{ fontSize: '10px', color: 'var(--fg-subtle)', marginTop: '2px' }}>
                  {msg.token_count} tokens
                </div>
              )}
            </div>
          ))}

          {/* Streaming indicator */}
          {streaming && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              color: 'var(--fg-muted)',
              fontSize: '12px',
            }}>
              <span style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'var(--accent)',
                animation: 'pulse 1s ease-in-out infinite',
              }} />
              Streaming... ({formatTime(elapsed)})
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div style={{
            padding: '8px 16px',
            color: 'var(--red)',
            fontSize: '12px',
            background: 'var(--bg-panel)',
            borderTop: '1px solid var(--border)',
          }}>
            {error}
          </div>
        )}

        {/* Input area */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-panel)',
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-end',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send)"
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              maxHeight: '120px',
              padding: '8px 12px',
              fontSize: '13px',
              fontFamily: 'var(--font)',
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              color: 'var(--fg)',
              outline: 'none',
            }}
          />
          {streaming ? (
            <button
              className="btn btn-danger btn-sm"
              onClick={stopStream}
            >
              Stop
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={sendMessage}
              disabled={!input.trim()}
            >
              Send
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
