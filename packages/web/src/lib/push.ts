import { api } from './api';

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'Notification' in window;
}

export function getPermissionState(): NotificationPermission {
  if (!('Notification' in window)) return 'denied';
  return Notification.permission;
}

export async function subscribePush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  // Tell SW to start polling for reminders
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ type: 'START_POLLING' });

  // Also try web-push subscription for Firefox/Safari (works in China)
  try {
    const res = await api.get<{ success: boolean; data: { publicKey: string } }>('/push/vapid-key');
    const publicKey = res.data.publicKey;
    if (publicKey) {
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
      });
      const raw = subscription.toJSON();
      await api.post('/push/subscribe', {
        endpoint: raw.endpoint,
        keys: { p256dh: raw.keys!.p256dh, auth: raw.keys!.auth },
      });
    }
  } catch {
    // Web Push subscription failed (likely FCM blocked), but polling still works
    console.log('[Push] Web Push subscription failed, falling back to polling only');
  }

  localStorage.setItem('push_enabled', 'true');
  return true;
}

export async function unsubscribePush(): Promise<void> {
  localStorage.removeItem('push_enabled');

  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: 'STOP_POLLING' });

    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ endpoint }),
      });
    }
  } catch {
    // ignore
  }
}

export function isSubscribed(): boolean {
  if (!isPushSupported()) return false;
  return localStorage.getItem('push_enabled') === 'true';
}

export function setupServiceWorkerMessageHandler() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'GET_TOKEN') {
      const token = localStorage.getItem('token');
      event.ports[0]?.postMessage({ token });
    }
  });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
