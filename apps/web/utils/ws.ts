

import { useAuthStore } from '../store/auth';
import type { WebSocketEvent } from './types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';
const RECONNECT_DELAY_MS = 3000;

type EventHandler = (event: WebSocketEvent) => void;

let socket:    WebSocket | null = null;
const listeners: Set<EventHandler> = new Set();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;

function getToken(): string | null {
  return useAuthStore.getState().token;
}

export function connectWebSocket(): void {
  if (typeof window === 'undefined') return; // SSR guard
  if (socket?.readyState === WebSocket.OPEN) return; // already connected

  const token = getToken();
  if (!token) {
    console.warn('WS: no token available, skipping connection');
    return;
  }

  intentionalClose = false;
  socket = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(token)}`);

  socket.onopen = () => {
    console.log('WS connected');
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  socket.onmessage = (msg) => {
    let event: WebSocketEvent;
    try { event = JSON.parse(msg.data); } catch { return; }
    listeners.forEach(fn => fn(event));
  };

  socket.onclose = () => {
    socket = null;
    if (!intentionalClose) {
      // Auto-reconnect after delay
      reconnectTimer = setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
    }
  };

  socket.onerror = (err) => {
    console.error('WS error', err);
    socket?.close();
  };
}

// Returns a cleanup function — call it from useEffect return
export function addWebSocketListener(fn: EventHandler): () => void {
  listeners.add(fn);
  // Ensure connection is live when a listener registers
  connectWebSocket();
  return () => listeners.delete(fn);
}

export function closeWebSocket(): void {
  intentionalClose = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  socket?.close();
  socket = null;
  listeners.clear();
}

export function sendWebSocketMessage(data: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}
