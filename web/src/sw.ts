/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const POLL_INTERVAL = 600_000; // 10 minutes

async function checkReminders() {
  try {
    const res = await fetch('/api/v1/push/due-reminders', {
      method: 'POST',
      credentials: 'same-origin',
    });

    if (!res.ok) return;

    const data = await res.json();
    if (!data.success || !data.data?.length) return;

    for (const reminder of data.data) {
      await self.registration.showNotification(reminder.title, {
        body: reminder.body,
        icon: '/baby.svg',
        badge: '/baby.svg',
        data: { url: '/' },
        requireInteraction: true,
      });
    }
  } catch {
    // silently fail
  }
}

// Start polling
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(checkReminders, POLL_INTERVAL);
  checkReminders();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

self.addEventListener('activate', () => {
  startPolling();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data?.type === 'START_POLLING') {
    startPolling();
  } else if (event.data?.type === 'STOP_POLLING') {
    stopPolling();
  }
});

// Handle push events (still support if user is on Firefox/Safari where push works)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const payload = event.data.json() as {
    title: string;
    body: string;
    icon?: string;
    data?: Record<string, unknown>;
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon || '/baby.svg',
      badge: '/baby.svg',
      data: payload.data,
      requireInteraction: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow('/');
    })
  );
});
