/**
 * Session data access — loading from state.db, caching, profile management.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { shell } from './shell';
import { parseHermesSessionsList, mergeSessionsFromSources } from './session-list';
import {
  hermesSidebarSessionsCache, hermesAllSessionsCache,
  updateSidebarCache, updateAllSessionsCache,
} from '../state';
import type { SessionData, Profile } from '../types';

const Database = require('../../lib/database');

export function getStateDbPath(profile?: string): string {
  if (profile && profile !== 'default') {
    return path.join(os.homedir(), '.hermes', 'profiles', profile, 'state.db');
  }
  return path.join(os.homedir(), '.hermes', 'state.db');
}

export function loadSessionsFromDb(stateDbPath: string, limit = 250): {
  dbSessions: any[];
  previewBySessionId: Record<string, string>;
  lastActivityBySessionId: Record<string, number>;
} {
  if (!fs.existsSync(stateDbPath)) return { dbSessions: [], previewBySessionId: {}, lastActivityBySessionId: {} };

  const db = new Database(stateDbPath, { readonly: true });
  try {
    const dbSessions = db.prepare(`
      SELECT id, title, parent_session_id, started_at, ended_at, message_count, source
      FROM sessions
      ORDER BY COALESCE(ended_at, started_at) DESC, id DESC
      LIMIT ?
    `).all(limit);

    const previewRows = db.prepare(`
      SELECT session_id, content
      FROM messages
      WHERE id IN (
        SELECT MAX(id)
        FROM messages
        WHERE content IS NOT NULL AND TRIM(content) != ''
        GROUP BY session_id
      )
    `).all();

    const previewBySessionId: Record<string, string> = {};
    for (const row of previewRows) {
      previewBySessionId[row.session_id] = row.content;
    }

    const lastActivityRows = db.prepare(`
      SELECT session_id, MAX(timestamp) as last_activity
      FROM messages
      GROUP BY session_id
    `).all();

    const lastActivityBySessionId: Record<string, number> = {};
    for (const row of lastActivityRows) {
      lastActivityBySessionId[row.session_id] = row.last_activity;
    }

    return { dbSessions, previewBySessionId, lastActivityBySessionId };
  } finally {
    db.close();
  }
}

export async function getSessions(): Promise<SessionData[]> {
  const now = Date.now();
  if (hermesSidebarSessionsCache.data.length && now - hermesSidebarSessionsCache.at < 10_000) {
    return hermesSidebarSessionsCache.data;
  }
  const data = await getAllSessions().then((sessions) => sessions.slice(0, 10)).catch(() => []);
  if (data.length) {
    updateSidebarCache({ at: now, data });
    return data;
  }
  if (hermesSidebarSessionsCache.data.length) {
    return hermesSidebarSessionsCache.data;
  }
  return [];
}

export async function getAllSessions(profile?: string): Promise<SessionData[]> {
  const now = Date.now();
  const cacheKey = profile || 'all';
  if (hermesAllSessionsCache.data.length && now - hermesAllSessionsCache.at < 10_000 && hermesAllSessionsCache.key === cacheKey) {
    return hermesAllSessionsCache.data;
  }
  const cmd = profile ? `hermes -p ${profile} sessions list --limit 250` : 'hermes sessions list --limit 250';
  const raw = await shell(cmd);
  if (raw) {
    const cliSessions = parseHermesSessionsList(raw);
    const stateDbPath = getStateDbPath(profile);
    const { dbSessions, previewBySessionId, lastActivityBySessionId } = loadSessionsFromDb(stateDbPath);
    const data = mergeSessionsFromSources({
      cliSessions,
      dbSessions,
      previewBySessionId,
      lastActivityBySessionId,
      nowMs: now,
    });
    updateAllSessionsCache({ at: now, data, key: cacheKey });
    return data;
  }

  try {
    const stateDbPath = getStateDbPath(profile);
    const { dbSessions, previewBySessionId, lastActivityBySessionId } = loadSessionsFromDb(stateDbPath);
    const data = mergeSessionsFromSources({ dbSessions, previewBySessionId, lastActivityBySessionId, nowMs: now });
    if (data.length) {
      updateAllSessionsCache({ at: now, data, key: cacheKey });
      return data;
    }
  } catch { }

  return [];
}

// ── Profile list parsing ──

export function parseHermesProfileList(raw: string): Profile[] {
  const lines = String(raw || '').split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/profile\s+model\s+gateway/i.test(lines[i])) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) return [];
  const dataLines: string[] = [];
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i];
    if (/^[\s─▪▫·∙¤]+$/.test(line)) continue;
    if (line.toLowerCase().includes('python-dotenv')) continue;
    dataLines.push(line);
  }
  const profiles: Profile[] = [];
  for (const line of dataLines) {
    const active = line.includes('◆');
    const cleaned = line.replace(/[◆]+$/, '').replace(/\s*◆\s*/, '').trimEnd();
    const parts = cleaned.split(/\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3) continue;
    const gatewayIndex = parts.findIndex((p) => /^(running|stopped)$/i.test(p));
    if (gatewayIndex < 2) continue;
    const name = parts.slice(0, gatewayIndex - 1).join(' ');
    const model = parts[gatewayIndex - 1];
    const gateway = parts[gatewayIndex].toLowerCase();
    const alias = parts[gatewayIndex + 1] && parts[gatewayIndex + 1] !== '—'
      ? parts.slice(gatewayIndex + 1).join(' ')
      : null;
    profiles.push({ name: name || '', model: model || '—', gateway, alias, active });
  }
  return profiles;
}

// ── Profiles with cache ──

let profilesCache: { at: number; data: Profile[] } = { at: 0, data: [] };

export async function getProfiles(): Promise<Profile[]> {
  const now = Date.now();
  if (profilesCache.data.length && now - profilesCache.at < 15_000) return profilesCache.data;
  const raw = await shell('hermes profile list');
  console.log('[DEBUG getProfiles] raw shell output:', JSON.stringify(raw));
  if (raw) {
    const data = parseHermesProfileList(raw);
    try {
      const activeProfilePath = path.join(os.homedir(), '.hermes', 'active_profile');
      const actualActive = fs.existsSync(activeProfilePath)
        ? fs.readFileSync(activeProfilePath, 'utf8').trim()
        : 'default';
      data.forEach(p => { p.active = p.name === actualActive; });
    } catch { }
    console.log('[DEBUG getProfiles] parsed:', JSON.stringify(data));
    profilesCache = { at: now, data };
    return data;
  }
  if (profilesCache.data?.length) return profilesCache.data;
  return [];
}

export function invalidateProfilesCache(): void {
  profilesCache = { at: 0, data: [] };
}
