import { useEffect, useRef, useCallback, createContext, useContext } from 'react';

export type EventType =
  | 'record.created' | 'record.updated' | 'record.deleted'
  | 'plan.created' | 'plan.updated' | 'plan.deleted'
  | 'growth.created' | 'growth.updated' | 'growth.deleted'
  | 'milestone.change'
  | 'health.change'
  | 'moment.change';

export interface DataEvent {
  type: EventType;
  babyId?: string;
  id?: string;
  userId?: string;
}

type EventHandler = (event: DataEvent) => void;

class ServerEventBus {
  private source: EventSource | null = null;
  private handlers = new Set<EventHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  connect() {
    if (this.source) return;
    this.tryConnect();
  }

  private tryConnect() {
    try {
      this.source = new EventSource('/api/v1/events');

      this.source.onopen = () => {
        this.connected = true;
      };

      this.source.onmessage = (e) => {
        try {
          const data: DataEvent = JSON.parse(e.data);
          this.handlers.forEach((h) => h(data));
        } catch {
          // malformed event
        }
      };

      this.source.onerror = () => {
        this.source?.close();
        this.source = null;
        this.connected = false;
        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.handlers.size > 0) {
        this.tryConnect();
      }
    }, 5000);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    this.connected = false;
  }

  subscribe(handler: EventHandler) {
    this.handlers.add(handler);
    if (!this.source && !this.reconnectTimer) {
      this.connect();
    }
    return () => {
      this.handlers.delete(handler);
      if (this.handlers.size === 0) {
        this.disconnect();
      }
    };
  }

  get isConnected() {
    return this.connected;
  }
}

export const serverEvents = new ServerEventBus();

/**
 * Subscribe to server-sent data change events.
 * The handler is called for every event matching the specified types.
 * If no types are provided, the handler receives all events.
 */
export function useServerEvent(
  types: EventType | EventType[] | null,
  handler: (event: DataEvent) => void,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const typesKey = Array.isArray(types) ? types.sort().join(',') : types ?? '';

  useEffect(() => {
    const typeSet = types
      ? new Set(Array.isArray(types) ? types : [types])
      : null;

    return serverEvents.subscribe((evt) => {
      if (!typeSet || typeSet.has(evt.type)) {
        handlerRef.current(evt);
      }
    });
  }, [typesKey]);
}

/**
 * Connect to SSE when authenticated. Call this once at the app level.
 */
export function useServerEventsConnection(authenticated: boolean) {
  useEffect(() => {
    if (authenticated) {
      serverEvents.connect();
    } else {
      serverEvents.disconnect();
    }
    return () => serverEvents.disconnect();
  }, [authenticated]);
}
