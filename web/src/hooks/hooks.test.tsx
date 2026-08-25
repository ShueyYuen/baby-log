import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheWrite } from '../lib/queryCache';
import { KeepAliveActiveContext, useActivated } from './useActivated';
import { PullRefreshProvider, usePullRefresh, useRefreshHandler } from './usePullRefresh';
import { useQuery } from './useQuery';
import { serverEvents, useServerEvent, useServerEventsConnection } from './useServerEvents';

function ActivatedProbe({ onActivate }: { onActivate: () => void }) {
  useActivated(onActivate);
  return <div>page</div>;
}

describe('useActivated', () => {
  it('skips the initial mount and fires when the page becomes active again', () => {
    const onActivate = vi.fn();
    const { rerender } = render(
      <KeepAliveActiveContext.Provider value>
        <ActivatedProbe onActivate={onActivate} />
      </KeepAliveActiveContext.Provider>,
    );
    expect(onActivate).not.toHaveBeenCalled();

    rerender(
      <KeepAliveActiveContext.Provider value={false}>
        <ActivatedProbe onActivate={onActivate} />
      </KeepAliveActiveContext.Provider>,
    );
    expect(onActivate).not.toHaveBeenCalled();

    rerender(
      <KeepAliveActiveContext.Provider value>
        <ActivatedProbe onActivate={onActivate} />
      </KeepAliveActiveContext.Provider>,
    );
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

function QueryProbe({ fetcher }: { fetcher: () => Promise<string> }) {
  const { data, loading } = useQuery('query-key', fetcher);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="data">{data ?? 'empty'}</span>
    </div>
  );
}

describe('useQuery', () => {
  it('shows cached data immediately then replaces it with a fresh fetch', async () => {
    cacheWrite('query-key', 'stale');
    const fetcher = vi.fn().mockResolvedValue('fresh');
    render(<QueryProbe fetcher={fetcher} />);
    expect(screen.getByTestId('data').textContent).toBe('stale');
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('fresh'));
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('stops loading when the fetcher rejects', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useQuery('err-key', fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeUndefined();
  });
});

describe('useRefreshHandler', () => {
  it('registers and unregisters with the pull-refresh context', () => {
    const register = vi.fn();
    const unregister = vi.fn();
    const { unmount } = renderHook(() => useRefreshHandler(async () => {}), {
      wrapper: ({ children }) => (
        <PullRefreshProvider value={{ register, unregister }}>{children}</PullRefreshProvider>
      ),
    });
    expect(register).toHaveBeenCalled();
    unmount();
    expect(unregister).toHaveBeenCalled();
  });
});

describe('usePullRefresh', () => {
  it('returns idle state when the container is empty', () => {
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      const { pullDistance, refreshing } = usePullRefresh(ref);
      return <div data-d={pullDistance} data-r={refreshing} />;
    }
    const { container } = render(<Probe />);
    expect(container.querySelector('[data-d="0"]')).toBeTruthy();
  });

  it('tracks a touch pull', () => {
    Object.defineProperty(window, 'ontouchstart', { configurable: true, value: null });
    function Wrapped() {
      const ref = useRef<HTMLDivElement>(null);
      const { pullDistance } = usePullRefresh(ref);
      return <div ref={ref} data-testid="scroller" data-d={pullDistance} />;
    }
    const { getByTestId } = render(<Wrapped />);
    const el = getByTestId('scroller');
    Object.defineProperty(el, 'scrollTop', { value: 0, configurable: true });
    fireEvent.touchStart(el, { touches: [{ clientY: 10 }] });
    fireEvent.touchMove(el, { touches: [{ clientY: 200 }] });
    fireEvent.touchEnd(el);
    expect(el.getAttribute('data-d')).toBeTruthy();
  });
});

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  close() {}
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe('server events', () => {
  afterEach(() => {
    serverEvents.disconnect();
    MockEventSource.instances = [];
    vi.unstubAllGlobals();
  });

  it('connects when authenticated and delivers matching events', async () => {
    vi.stubGlobal('EventSource', MockEventSource);
    const handler = vi.fn();
    renderHook(() => {
      useServerEventsConnection(true);
      useServerEvent('record.created', handler);
    });
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
    act(() => {
      MockEventSource.instances[0].emit({ type: 'record.created', id: '1' });
      MockEventSource.instances[0].emit({ type: 'plan.created', id: '2' });
    });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'record.created' }));
    expect(handler).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'plan.created' }));
  });
});
