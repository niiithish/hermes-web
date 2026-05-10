'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type WSEventHandler = (data: Record<string, unknown>) => void;

interface UseWebSocketReturn {
  connected: boolean;
  subscribe: (type: string, handler: WSEventHandler) => () => void;
  send: (data: Record<string, unknown>) => boolean;
  lastMessage: Record<string, unknown> | null;
}

export function useWebSocket(): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<Record<string, unknown> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<WSEventHandler>>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPongRef = useRef(Date.now());
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        reconnectDelayRef.current = 1000;
        lastPongRef.current = Date.now();
        startPing(ws);
      };

      ws.onmessage = (ev) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(ev.data) as Record<string, unknown>;
          if (msg.type === 'pong') {
            lastPongRef.current = Date.now();
            return;
          }
          setLastMessage(msg);
          const type = String(msg.type || '');
          const handlers = handlersRef.current.get(type);
          if (handlers) {
            handlers.forEach((h) => h(msg));
          }
          // Also call wildcard handlers
          const wildcard = handlersRef.current.get('*');
          if (wildcard) {
            wildcard.forEach((h) => h(msg));
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        stopPing();
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    } catch {
      scheduleReconnect();
    }
  }, []);

  const startPing = useCallback((ws: WebSocket) => {
    stopPing();
    pingIntervalRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
        if (Date.now() - lastPongRef.current > 30000) {
          ws.close();
        }
      }
    }, 10000);
  }, []);

  const stopPing = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) return;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000);
      connect();
    }, reconnectDelayRef.current);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      stopPing();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, stopPing]);

  const subscribe = useCallback((type: string, handler: WSEventHandler): (() => void) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);
    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  const send = useCallback((data: Record<string, unknown>): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  return { connected, subscribe, send, lastMessage };
}
