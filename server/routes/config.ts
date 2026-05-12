/**
 * Config and API keys routes — YAML config, .env key management.
 */
import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import yaml from 'js-yaml';
import { requireAuth, requireCsrf, requireRole } from '../middleware/auth';
import { shell } from '../services/shell';
import { discoverGatewayPorts, resolveCorsOrigins } from '../services/gateway-discovery';
import { GATEWAY_API_KEY, setGatewayPorts } from '../state';

const authModule = require('../../auth');
const router = Router();

function sanitizeProfileName(name: any): string | null {
  const s = String(name || '').trim();
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null;
}

// Key metadata constants
const KEY_METADATA: Record<string, { cat: string; desc: string; url: string; adv: boolean }> = {
  OPENROUTER_API_KEY: { cat: 'LLM Providers', desc: 'OpenRouter API key', url: 'https://openrouter.ai/keys', adv: false },
  OPENAI_API_KEY: { cat: 'LLM Providers', desc: 'OpenAI API key', url: 'https://platform.openai.com/api-keys', adv: false },
  ANTHROPIC_API_KEY: { cat: 'LLM Providers', desc: 'Anthropic API key', url: 'https://console.anthropic.com/settings/keys', adv: false },
  DEEPSEEK_API_KEY: { cat: 'LLM Providers', desc: 'DeepSeek API key', url: 'https://platform.deepseek.com/api-keys', adv: false },
  GEMINI_API_KEY: { cat: 'LLM Providers', desc: 'Google Gemini API key', url: 'https://aistudio.google.com/app/apikey', adv: false },
  GROQ_API_KEY: { cat: 'LLM Providers', desc: 'Groq API key', url: 'https://console.groq.com/keys', adv: false },
  MISTRAL_API_KEY: { cat: 'LLM Providers', desc: 'Mistral API key', url: 'https://console.mistral.ai/api/', adv: false },
  TOGETHER_API_KEY: { cat: 'LLM Providers', desc: 'Together AI API key', url: 'https://api.together.xyz/settings/api-keys', adv: false },
  LLM_MODEL: { cat: 'LLM Providers', desc: 'Default LLM model', url: '', adv: false },
  LLM_PROVIDER: { cat: 'LLM Providers', desc: 'Default LLM provider', url: '', adv: false },
  FIRECRAWL_API_KEY: { cat: 'Tool APIs', desc: 'Firecrawl API key', url: 'https://firecrawl.dev', adv: false },
  TAVILY_API_KEY: { cat: 'Tool APIs', desc: 'Tavily API key', url: 'https://app.tavily.com', adv: false },
  ELEVENLABS_API_KEY: { cat: 'Tool APIs', desc: 'ElevenLabs API key', url: 'https://elevenlabs.io/api', adv: false },
  TELEGRAM_BOT_TOKEN: { cat: 'Messaging Platforms', desc: 'Telegram bot token', url: 'https://t.me/BotFather', adv: false },
  DISCORD_BOT_TOKEN: { cat: 'Messaging Platforms', desc: 'Discord bot token', url: 'https://discord.com/developers/applications', adv: false },
  HERMES_CONTROL_PASSWORD: { cat: 'Agent Settings', desc: 'HCI control password', url: '', adv: false },
  HERMES_CONTROL_SECRET: { cat: 'Agent Settings', desc: 'HCI control secret', url: '', adv: true },
};

function getKeyMeta(name: string) {
  if (KEY_METADATA[name]) return KEY_METADATA[name];
  if (name.startsWith('MCP_')) return { cat: 'MCP Keys', desc: `MCP configuration: ${name}`, url: '', adv: true };
  if (/_API_KEY$|_KEY$|_TOKEN$|_SECRET$|_PASSWORD$/i.test(name)) return { cat: 'Advanced', desc: name, url: '', adv: true };
  return { cat: 'Advanced', desc: name, url: '', adv: true };
}

// Config show
router.get('/config/:profile', requireAuth, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile);
    if (!profile) return res.status(400).json({ ok: false, error: 'invalid profile name' });
    const home = profile === 'default' ? `${process.env.HOME}/.hermes` : `${process.env.HOME}/.hermes/profiles/${profile}`;
    const configPath = `${home}/config.yaml`;
    const raw = await shell(`cat "${configPath}" 2>/dev/null || echo "not_found"`);
    if (raw.trim() === 'not_found') return res.json({ ok: false, error: 'Config not found' });
    const config = yaml.load(raw) || {};
    res.json({ ok: true, config, raw_yaml: raw });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// Config update
router.put('/config/:profile', requireAuth, requireRole('admin'), requireCsrf, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile);
    if (!profile) return res.status(400).json({ ok: false, error: 'invalid profile name' });
    const home = profile === 'default' ? `${process.env.HOME}/.hermes` : `${process.env.HOME}/.hermes/profiles/${profile}`;
    const configPath = `${home}/config.yaml`;
    const newConfig = req.body?.config;
    if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) return res.status(400).json({ ok: false, error: 'config must be a non-array object' });
    const backupPath = `${configPath}.bak.${Date.now()}`;
    await shell(`cp "${configPath}" "${backupPath}" 2>/dev/null || true`);

    const existingPorts = discoverGatewayPorts();
    if (newConfig.platforms?.api_server?.enabled) {
      const requestedPort = newConfig.platforms.api_server.extra?.port;
      if (requestedPort) {
        const conflict = Object.entries(existingPorts).find(([p, pt]) => p !== profile && pt === requestedPort);
        if (conflict) { let newPort = 8650; while (Object.values(existingPorts).includes(newPort)) newPort++; newConfig.platforms.api_server.extra.port = newPort; }
      }
    } else {
      const myPort = existingPorts[profile]; let port = myPort || 8650;
      if (Object.values(existingPorts).includes(port) && !myPort) { while (Object.values(existingPorts).includes(port)) port++; }
      newConfig.platforms = newConfig.platforms || {};
      newConfig.platforms.api_server = { enabled: true, extra: { host: '127.0.0.1', port, key: GATEWAY_API_KEY, cors_origins: resolveCorsOrigins(req) } };
    }

    const yamlLib = require('yaml');
    const doc = new yamlLib.Document(newConfig);
    doc.commentBefore = ' Managed by Hermes Control Interface';
    const yamlStr = doc.toString();
    const parsed = yamlLib.parse(yamlStr);
    if (!parsed || typeof parsed !== 'object') return res.status(400).json({ ok: false, error: 'Generated YAML is invalid' });

    fs.writeFileSync(configPath, yamlStr + '\n');
    setGatewayPorts(discoverGatewayPorts());
    authModule.audit(req.hciUser?.username || 'unknown', req.hciUser?.role || 'unknown', 'CONFIG_UPDATE', profile);
    res.json({ ok: true, backup: backupPath });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// Keys — list
router.get('/keys/:profile', requireAuth, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile);
    if (!profile) return res.status(400).json({ ok: false, error: 'invalid profile name' });
    const home = profile === 'default' ? `${process.env.HOME}/.hermes` : `${process.env.HOME}/.hermes/profiles/${profile}`;
    const raw = await shell(`cat "${home}/.env" 2>/dev/null || echo ""`);
    if (!raw.trim()) return res.json({ ok: true, keys: [], categories: [] });
    const keys: any[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const name = trimmed.substring(0, eqIdx).trim();
      const value = trimmed.substring(eqIdx + 1).trim();
      const masked = value.length > 4 ? value.substring(0, 2) + '•'.repeat(Math.min(value.length - 4, 20)) + value.substring(value.length - 2) : '•'.repeat(value.length);
      const meta = getKeyMeta(name);
      keys.push({ name, masked, has_value: value.length > 0, category: meta.cat, description: meta.desc, provider_url: meta.url, is_advanced: meta.adv });
    }
    const cats: Record<string, any[]> = {};
    const catOrder = ['LLM Providers', 'Tool APIs', 'Messaging Platforms', 'Agent Settings', 'MCP Keys', 'Advanced'];
    keys.forEach(k => { if (!cats[k.category]) cats[k.category] = []; cats[k.category].push(k); });
    const categories = catOrder.filter(c => cats[c]).map(c => ({ name: c, keys: cats[c] }));
    Object.keys(cats).forEach(c => { if (!catOrder.includes(c) && c !== 'Advanced') categories.push({ name: c, keys: cats[c] }); });
    res.json({ ok: true, keys, categories });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// Keys — reveal
router.get('/keys/:profile/reveal/:name', requireAuth, requireRole('admin'), async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile);
    const keyName = req.params.name;
    if (!profile || !keyName) return res.status(400).json({ ok: false, error: 'invalid params' });
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyName)) return res.status(400).json({ ok: false, error: 'invalid key name' });
    const home = profile === 'default' ? `${process.env.HOME}/.hermes` : `${process.env.HOME}/.hermes/profiles/${profile}`;
    const raw = await shell(`grep -E "^${keyName}=" "${home}/.env" 2>/dev/null || echo ""`);
    if (!raw.trim()) return res.json({ ok: false, error: 'Key not found' });
    const value = raw.trim().substring(raw.indexOf('=') + 1).trim();
    authModule.audit(req.hciUser?.username || 'unknown', req.hciUser?.role || 'unknown', 'KEY_REVEAL', `${profile}:${keyName}`);
    res.json({ ok: true, value });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// Keys — save/update
router.put('/keys/:profile', requireAuth, requireRole('admin'), requireCsrf, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile);
    if (!profile) return res.status(400).json({ ok: false, error: 'invalid profile name' });
    const { name, value } = req.body || {};
    if (!name || typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return res.status(400).json({ ok: false, error: 'invalid key name' });
    if (typeof value !== 'string') return res.status(400).json({ ok: false, error: 'value must be a string' });
    const home = profile === 'default' ? `${process.env.HOME}/.hermes` : `${process.env.HOME}/.hermes/profiles/${profile}`;
    const envPath = `${home}/.env`;
    const raw = await shell(`cat "${envPath}" 2>/dev/null || echo ""`);
    const lines = raw.split('\n');
    const keyRegex = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=`);
    const existingIdx = lines.findIndex(l => keyRegex.test(l.trim()));
    const needsQuote = /[\s"'`$\\#!]/.test(value) || value === '';
    const line = needsQuote ? `${name}='${value.replace(/'/g, "'\\''")}'` : `${name}=${value}`;
    if (existingIdx >= 0) lines[existingIdx] = line; else lines.push(line);
    fs.writeFileSync(envPath, lines.join('\n') + '\n');
    authModule.audit(req.hciUser?.username || 'unknown', req.hciUser?.role || 'unknown', 'KEY_UPDATE', `${profile}:${name}`);
    res.json({ ok: true });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

// Keys — delete
router.delete('/keys/:profile/:name', requireAuth, requireRole('admin'), requireCsrf, async (req: any, res) => {
  try {
    const profile = sanitizeProfileName(req.params.profile);
    const keyName = req.params.name;
    if (!profile || !keyName) return res.status(400).json({ ok: false, error: 'invalid params' });
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyName)) return res.status(400).json({ ok: false, error: 'invalid key name' });
    const home = profile === 'default' ? `${process.env.HOME}/.hermes` : `${process.env.HOME}/.hermes/profiles/${profile}`;
    await shell(`sed -i '/^${keyName}=/d' "${home}/.env"`);
    authModule.audit(req.hciUser?.username || 'unknown', req.hciUser?.role || 'unknown', 'KEY_DELETE', `${profile}:${keyName}`);
    res.json({ ok: true });
  } catch (e: any) { res.json({ ok: false, error: e.message }); }
});

export default router;
