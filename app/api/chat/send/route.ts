import { NextRequest } from 'next/server';

const BACKEND_URL = process.env.HCI_BACKEND_URL || 'http://localhost:10272';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json();

  // Forward the request to the Express backend with auth cookies
  const forwardHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const cookie = request.headers.get('cookie');
  if (cookie) forwardHeaders['Cookie'] = cookie;

  const csrf = request.headers.get('x-csrf-token');
  if (csrf) forwardHeaders['X-CSRF-Token'] = csrf;

  try {
    const backendRes = await fetch(`${BACKEND_URL}/api/chat/send`, {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(body),
    });

    if (!backendRes.ok || !backendRes.body) {
      const errText = await backendRes.text().catch(() => 'Backend error');
      return new Response(
        JSON.stringify({ error: errText }),
        { status: backendRes.status, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Explicitly pipe the backend SSE stream chunk-by-chunk.
    // Passing backendRes.body directly can sometimes be buffered by the runtime;
    // an explicit ReadableStream pipe guarantees each chunk is forwarded immediately.
    const reader = backendRes.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      },
      cancel() {
        reader.cancel();
      },
    });

    return new Response(stream, {
      status: backendRes.status,
      headers: {
        'Content-Type': backendRes.headers.get('content-type') || 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backend connection failed';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
