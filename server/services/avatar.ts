/**
 * Avatar helpers — reading, writing, and caching avatar data URLs.
 */
import fs from 'fs';
import {
  AVATAR_OVERRIDE_PATH, CONTROL_STATE_DIR, DEFAULT_AVATAR_FALLBACK,
  avatarDataUrlCache, setAvatarCache, log,
} from '../state';

export function ensureControlStateDir(): void {
  fs.mkdirSync(CONTROL_STATE_DIR, { recursive: true });
}

export function readAvatarOverride(): string {
  try {
    return fs.readFileSync(AVATAR_OVERRIDE_PATH, 'utf8').trim();
  } catch {
    return '';
  }
}

export function writeAvatarOverride(dataUrl: string): void {
  ensureControlStateDir();
  fs.writeFileSync(AVATAR_OVERRIDE_PATH, String(dataUrl || ''), 'utf8');
  setAvatarCache(String(dataUrl || ''));
}

export function clearAvatarOverride(): void {
  setAvatarCache(null);
  try { fs.unlinkSync(AVATAR_OVERRIDE_PATH); } catch { }
}

export function getAvatarDataUrl(): string {
  if (avatarDataUrlCache) return avatarDataUrlCache;
  const override = readAvatarOverride();
  if (override) {
    setAvatarCache(override);
    return override;
  }
  try {
    const buf = fs.readFileSync(DEFAULT_AVATAR_FALLBACK);
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
    setAvatarCache(dataUrl);
    return dataUrl;
  } catch (error: any) {
    log('avatar.missing', error.message || 'avatar image not found');
    setAvatarCache('');
    return '';
  }
}
