'use client';

export default function LogsPage() {
  return (
    <div style={{ padding: '24px', height: '100%', overflowY: 'auto' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>Logs</h1>
      <p style={{ color: 'var(--fg-muted)', marginBottom: '24px' }}>
        Real-time agent and system logs
      </p>
      <div style={{ color: 'var(--fg-muted)', fontStyle: 'italic' }}>
        Log viewer coming soon...
      </div>
    </div>
  );
}
