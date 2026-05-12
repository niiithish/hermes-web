/**
 * Type declarations for auth.js (kept as CommonJS)
 */
export const USERS_FILE: string;
export const AUDIT_FILE: string;
export function loadUsers(): { users: any[] };
export function saveUsers(data: { users: any[] }): void;
export function isFirstRun(): boolean;
export function findUser(username: string): any | null;
export function createUser(username: string, password: string, role?: string): { ok: boolean; error?: string };
export function deleteUser(username: string, currentUser: string): { ok: boolean; error?: string };
export function verifyUserPassword(username: string, password: string): any | null;
export function changePassword(username: string, currentPassword: string, newPassword: string): { ok: boolean; error?: string };
export function resetUserPassword(username: string, newPassword: string, adminUser: string): { ok: boolean; error?: string };
export function sanitizeUsername(name: string): string | null;
export function listUsers(): { username: string; role: string; created_at: string; last_login: string | null }[];
export function updateUserPermissions(username: string, role: string, permissions?: Record<string, boolean>): { ok: boolean; error?: string };
export const PERMISSIONS: string[];
export const PRESET_PERMISSIONS: Record<string, Record<string, boolean>>;
export function resolvePermissions(role: string, permissions?: Record<string, boolean>): Record<string, boolean>;
export function audit(username: string, role: string, action: string, details?: string): void;
export function getAuditLog(limit?: number): string[];
export function loadNotifications(): any[];
export function addNotification(type: string, message: string): void;
export function dismissNotification(id: string): void;
export function clearNotifications(): void;
