/**
 * System health, monitoring, agent status routes.
 */
import { Router } from 'express';
import os from 'os';
import { requireAuth } from '../middleware/auth';
import { shell } from '../services/shell';
import { getSystem, checkSystemHealth } from '../services/dashboard';

const router = Router();

// Health check (no auth — used by load balancers)
router.get('/health', (req, res) => {
  res.json({ ok: true, title: 'Hermes Control Interface', auth: true, ws: '/ws' });
});

// System health
router.get('/system/health', requireAuth, async (req, res) => {
  try {
    const memTotalMb = Math.round(os.totalmem() / 1024 / 1024);
    const memUsedMb = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
    const cpuCores = Math.max(1, os.cpus().length || 1);
    const load1 = os.loadavg()[0] || 0;
    const cpuPct = Math.min(100, Math.max(0, Math.round((load1 / cpuCores) * 100)));

    const [disk, version, agents, sessions] = await Promise.all([
      shell("df -h / | awk 'NR==2 {print $3\"/\"$2\" (\"$5\")\"}'"),
      shell("hermes version 2>&1 | head -1"),
      shell("hermes profile list 2>&1 | wc -l"),
      shell("hermes sessions list --limit 1000 2>&1 | wc -l"),
    ]);
    const upSec = process.uptime();
    const upDays = Math.floor(upSec / 86400);
    const upHrs = Math.floor((upSec % 86400) / 3600);
    const upMins = Math.floor((upSec % 3600) / 60);
    const uptime = upDays > 0 ? `${upDays}d ${upHrs}h ${upMins}m` : upHrs > 0 ? `${upHrs}h ${upMins}m` : `${upMins}m`;
    res.json({
      ok: true,
      cpu: `${cpuPct}% (${load1.toFixed(2)} load / ${cpuCores} cores)`,
      ram: `${memUsedMb}/${memTotalMb}MB (${Math.round((memUsedMb / memTotalMb) * 100)}%)`,
      disk: disk.trim() || 'N/A',
      uptime,
      hermes_version: version.trim() || 'N/A',
      hci_version: require('../../package.json').version,
      node_version: process.version,
      agents: Math.max(0, parseInt(agents.trim()) - 2) || 0,
      sessions: Math.max(0, parseInt(sessions.trim()) - 2) || 0,
    });
  } catch (e: any) {
    res.json({ ok: false, error: e.message });
  }
});

// Detailed monitoring
router.get('/monitoring', requireAuth, async (req, res) => {
  try {
    const memTotalMb = Math.round(os.totalmem() / 1024 / 1024);
    const memUsedMb = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
    const cpuCores = Math.max(1, os.cpus().length || 1);
    const loadAvg = os.loadavg();
    const load1 = loadAvg[0] || 0;
    const cpuPct = Math.min(100, Math.max(0, Math.round((load1 / cpuCores) * 100)));

    const [disk, netio, processes, uptime, version] = await Promise.all([
      shell("df -h / | awk 'NR==2 {print $3\"/\"$2\" (\"$5\")\"}'"),
      shell("cat /proc/net/dev | awk 'NR==3 {print $1, $9}'"),
      shell("ps aux --no-headers | wc -l"),
      shell("uptime | awk -F'up ' '{split($2,a,\" user\");print a[1]\", \"$3}'"),
      shell("hermes version 2>&1 | head -1"),
    ]);

    const netParts = (netio || 'lo 0').trim().split(/\s+/);
    const memInfo = `${memUsedMb}/${memTotalMb}MB (${Math.round((memUsedMb / memTotalMb) * 100)}%)`;
    const memPctNum = Math.round((memUsedMb / memTotalMb) * 100);
    const diskInfo = disk.trim() || 'N/A';
    const diskPctMatch = diskInfo.match(/\((\d+)%\)/);
    const diskPctNum = diskPctMatch ? parseFloat(diskPctMatch[1]) : 0;
    const nodeMem = process.memoryUsage();

    res.json({
      ok: true,
      cpu: `${cpuPct}%`,
      memory: memInfo,
      disk: diskInfo,
      cpu_pct: cpuPct,
      mem_pct: memPctNum,
      disk_pct: diskPctNum,
      load: { avg1: load1.toFixed(2), avg5: loadAvg[1]?.toFixed(2) || '0', avg15: loadAvg[2]?.toFixed(2) || '0' },
      network: { interface: netParts[0] || 'eth0', bytes: netParts[1] || '0', packets: netParts[2] || '0' },
      processes: parseInt(processes.trim()) || 0,
      uptime: uptime.trim() || 'N/A',
      hermes_version: version.trim() || 'N/A',
      hci_version: require('../../package.json').version,
      node_version: process.version,
      node_memory: {
        rss_mb: Math.round(nodeMem.rss / 1024 / 1024),
        heap_used_mb: Math.round(nodeMem.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(nodeMem.heapTotal / 1024 / 1024),
      },
    });
  } catch (e: any) {
    res.json({ ok: false, error: e.message });
  }
});

// Agent status
router.get('/agent/status', requireAuth, async (req, res) => {
  try {
    const { probeGatewayHealth } = require('../services/gateway-discovery');
    const raw = await shell('hermes status 2>&1', '15s');
    const grab = (label: string): string => {
      const re = new RegExp(label + ':\\s+(.+)');
      const m = raw.match(re);
      return m ? m[1].trim() : '';
    };
    const model = grab('Model');
    const provider = grab('Provider');
    let gatewayStatus = 'unknown';
    let gatewayManagedBy = 'unknown';
    try {
      const probe = await probeGatewayHealth('default');
      gatewayStatus = probe.ok ? 'running' : 'stopped';
      gatewayManagedBy = probe.managedBy;
    } catch {
      gatewayStatus = grab('Status');
    }

    const keyLines = raw.match(/◆ API Keys\n([\s\S]*?)(?:\n◆|\n──)/);
    const apiKeys = { active: 0, total: 0 };
    if (keyLines) {
      const kLines = keyLines[1].split('\n').filter((l: string) => l.trim());
      apiKeys.total = kLines.length;
      apiKeys.active = kLines.filter((l: string) => l.includes('✓')).length;
    }

    const platLines = raw.match(/◆ Messaging Platforms\n([\s\S]*?)(?:\n◆|\n──)/);
    const platforms: any[] = [];
    if (platLines) {
      for (const l of platLines[1].split('\n')) {
        const m = l.match(/^\s+(\S.+?)\s+(✓|✗)\s+(.+)/);
        if (m) platforms.push({ name: m[1].trim(), configured: m[2] === '✓', detail: m[3].trim() });
      }
    }

    const authLines = raw.match(/◆ Auth Providers\n([\s\S]*?)(?:\n◆|\n──)/);
    const authProviders: any[] = [];
    if (authLines) {
      for (const l of authLines[1].split('\n')) {
        const m = l.match(/^\s+(\S.+?)\s+(✓|✗)\s+(.+)/);
        if (m) authProviders.push({ name: m[1].trim(), loggedIn: m[2] === '✓', detail: m[3].trim() });
      }
    }

    res.json({
      ok: true,
      model, provider, gatewayStatus, gatewayManagedBy,
      activeSessions: parseInt(grab('Active')) || 0,
      scheduledJobs: parseInt(grab('Jobs')) || 0,
      apiKeys, platforms, authProviders,
    });
  } catch (e: any) {
    res.json({ ok: false, error: e.message });
  }
});

export default router;
