'use client';

import { useParams } from 'next/navigation';

export default function AgentDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  return (
    <div style={{ padding: '24px', height: '100%', overflowY: 'auto' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>Agent Detail</h1>
      <p style={{ color: 'var(--fg-muted)', marginBottom: '24px' }}>
        Session: {id}
      </p>
      <div style={{ color: 'var(--fg-muted)', fontStyle: 'italic' }}>
        Agent detail view coming soon...
      </div>
    </div>
  );
}
