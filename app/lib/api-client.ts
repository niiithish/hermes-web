/**
 * HCI API Client — communicates with the Express backend
 */

const API_BASE = '';

interface ApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  [key: string]: T | boolean | string | undefined;
}

class ApiClient {
  private csrfToken: string | null = null;

  setCsrfToken(token: string | null) {
    this.csrfToken = token;
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add CSRF token for mutating requests
    if (this.csrfToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(data.error || `Request failed: ${res.status}`, res.status);
    }

    return res.json();
  }

  // Auth
  async getAuthStatus(): Promise<{ ok: boolean; first_run: boolean; user_count: number }> {
    return this.request('GET', '/api/auth/status');
  }

  async getMe(): Promise<{ ok: boolean; user: { username: string; role: string; permissions?: Record<string, boolean> }; csrfToken: string }> {
    return this.request('GET', '/api/auth/me');
  }

  async login(username: string, password: string): Promise<{ ok: boolean; user: { username: string; role: string; permissions?: Record<string, boolean> }; csrfToken: string }> {
    return this.request('POST', '/api/auth/login', { username, password });
  }

  async setup(username: string, password: string): Promise<{ ok: boolean; user: { username: string; role: string }; csrfToken: string }> {
    return this.request('POST', '/api/auth/setup', { username, password });
  }

  async logout(): Promise<{ ok: boolean }> {
    return this.request('POST', '/api/auth/logout');
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
    return this.request('POST', '/api/auth/change-password', { current_password: currentPassword, new_password: newPassword });
  }

  // Session / Auth check
  async getSession(): Promise<{ authenticated: boolean; csrfToken?: string; identity: string }> {
    return this.request('GET', '/api/session');
  }

  // Dashboard
  async getDashboard(): Promise<{ ok: boolean; [key: string]: unknown }> {
    return this.request('GET', '/api/dashboard');
  }

  // Sessions
  async getSessions(): Promise<{ ok: boolean; sessions: unknown[] }> {
    return this.request('GET', '/api/sessions');
  }

  async getAllSessions(): Promise<{ ok: boolean; sessions: unknown[] }> {
    return this.request('GET', '/api/sessions/all');
  }

  async getSessionMessages(sessionId: string): Promise<{ ok: boolean; messages: unknown[]; session: unknown }> {
    return this.request('GET', `/api/sessions/${encodeURIComponent(sessionId)}/messages`);
  }

  async deleteSession(sessionId: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/api/sessions/${encodeURIComponent(sessionId)}`);
  }

  // Chat
  async chatSend(body: { message: string; profile?: string; sessionId?: string; model?: string }): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    return fetch(`${API_BASE}/api/chat/send`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
  }

  async chatFork(sessionId: string, messageIndex: number, profile?: string): Promise<{ ok: boolean; newSessionId: string; forkedSession: unknown }> {
    return this.request('POST', '/api/chat/fork', { sessionId, messageIndex, profile });
  }

  // Gateway
  async getGatewayPorts(): Promise<{ ports: Record<string, number>; profiles: string[] }> {
    return this.request('GET', '/api/gateway/ports');
  }

  // Models
  async getModels(): Promise<{ ok: boolean; default: string; provider: string; groups: { provider: string; models: string[] }[] }> {
    return this.request('GET', '/api/models');
  }

  // Profiles
  async getProfiles(): Promise<{ ok: boolean; profiles: { name: string; active: boolean }[] }> {
    return this.request('GET', '/api/profiles');
  }

  // Insights
  async getInsights(days = 7): Promise<{ ok: boolean; insights: unknown }> {
    return this.request('GET', `/api/insights?days=${days}`);
  }

  // Cron
  async getCronJobs(): Promise<{ ok: boolean; jobs: unknown[] }> {
    return this.request('GET', '/api/cron');
  }

  // Skills
  async getSkills(): Promise<{ ok: boolean; skills: string[] }> {
    return this.request('GET', '/api/skills');
  }

  // Plugins
  async getPlugins(): Promise<{ ok: boolean; plugins: unknown[] }> {
    return this.request('GET', '/api/plugins');
  }

  // Files
  async getFileTree(): Promise<{ ok: boolean; roots: unknown[] }> {
    return this.request('GET', '/api/files/tree');
  }

  async readFile(path: string): Promise<{ ok: boolean; content: string; path: string }> {
    return this.request('GET', `/api/files/read?path=${encodeURIComponent(path)}`);
  }

  // Users
  async getUsers(): Promise<{ ok: boolean; users: unknown[] }> {
    return this.request('GET', '/api/users');
  }

  async createUser(username: string, password: string, role: string, permissions?: Record<string, boolean>): Promise<{ ok: boolean }> {
    return this.request('POST', '/api/users', { username, password, role, permissions });
  }

  async updateUser(username: string, role: string, permissions?: Record<string, boolean>): Promise<{ ok: boolean }> {
    return this.request('PUT', `/api/users/${encodeURIComponent(username)}`, { role, permissions });
  }

  async deleteUser(username: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/api/users/${encodeURIComponent(username)}`);
  }

  async getNotifications(): Promise<unknown[]> {
    return this.request('GET', '/api/notifications');
  }

  async dismissNotification(id: string): Promise<{ ok: boolean }> {
    return this.request('POST', '/api/notifications/dismiss', { id });
  }

  async clearNotifications(): Promise<{ ok: boolean }> {
    return this.request('POST', '/api/notifications/clear');
  }

  // Logs
  async getLogs(type?: string, level?: string): Promise<{ ok: boolean; logs: string }> {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (level) params.set('level', level);
    return this.request('GET', `/api/logs?${params}`);
  }

  // System
  async getSystem(): Promise<{ ok: boolean; system: unknown }> {
    return this.request('GET', '/api/system');
  }

  async getSystemInfo(): Promise<{ ok: boolean; info: unknown }> {
    return this.request('GET', '/api/system/info');
  }

  // Terminal
  async terminalExec(command: string): Promise<{ ok: boolean; output: string }> {
    return this.request('POST', '/api/terminal/exec', { command });
  }

  async terminalResize(cols: number, rows: number): Promise<{ ok: boolean }> {
    return this.request('POST', '/api/terminal/resize', { cols, rows });
  }

  // Maintenance
  async hermesDoctor(): Promise<{ ok: boolean; output: string }> {
    return this.request('POST', '/api/maintenance/doctor');
  }

  async hermesUpdate(): Promise<{ ok: boolean; output: string }> {
    return this.request('POST', '/api/maintenance/update');
  }

  async hermesRestart(): Promise<{ ok: boolean; output: string }> {
    return this.request('POST', '/api/maintenance/restart');
  }

  async hermesBackup(): Promise<{ ok: boolean; output: string }> {
    return this.request('POST', '/api/maintenance/backup');
  }

  // Generic request
  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  async del<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const api = new ApiClient();
