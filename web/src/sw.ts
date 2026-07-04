/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

const POLL_INTERVAL = 600_000; // 10 minutes

async function checkReminders() {
  try {
    const token = await getToken();
    if (!token) return;

    const res = await fetch('/api/v1/push/due-reminders', {
      headers: { Authorization: `Bearer ${token}` },
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

async function getToken(): Promise<string | null> {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    const msg = await sendMessageToClient(client, { type: 'GET_TOKEN' });
    if (msg?.token) return msg.token;
  }
  return null;
}

function sendMessageToClient(client: Client, message: any): Promise<any> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => resolve(event.data);
    client.postMessage(message, [channel.port2]);
    setTimeout(() => resolve(null), 3000);
  });
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
  if (event.data?.type === 'START_POLLING') {
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
