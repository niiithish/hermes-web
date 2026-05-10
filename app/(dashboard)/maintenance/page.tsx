'use client';

export default function MaintenancePage() {
  return (
    <div style={{ padding: '24px', height: '100%', overflowY: 'auto' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>Maintenance</h1>
      <p style={{ color: 'var(--fg-muted)', marginBottom: '24px' }}>
        System maintenance, updates, backups, and diagnostics
      </p>
      <div style={{ color: 'var(--fg-muted)', fontStyle: 'italic' }}>
        Maintenance tools coming soon...
      </div>
    </div>
  );
}
