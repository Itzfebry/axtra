"use client";

/**
 * Client-side Web Push helpers. Registers the service worker, asks for the
 * notification permission, and syncs the subscription with the backend.
 */

import { fetchPushConfig, subscribePush, unsubscribePush } from "@/lib/api";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Convert a base64url VAPID key into the bytes PushManager expects. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

/** The current browser subscription, if any. */
export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return (await registration.pushManager.getSubscription()) ?? null;
}

/** True when this browser already has an active push subscription. */
export async function isPushEnabled(): Promise<boolean> {
  return (await getPushSubscription()) !== null;
}

/** Request permission, subscribe, and register the endpoint with the backend. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) {
    throw new Error("Browser ini tidak mendukung notifikasi Web Push.");
  }
  const config = await fetchPushConfig();
  if (!config.enabled || !config.public_key) {
    throw new Error("Web Push belum dikonfigurasi di server.");
  }
  if (Notification.permission === "denied") {
    throw new Error("Izin notifikasi diblokir. Aktifkan lewat pengaturan browser.");
  }
  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Izin notifikasi tidak diberikan.");
  }
  const registration = await registerServiceWorker();
  if (!registration) throw new Error("Gagal mendaftarkan service worker.");
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.public_key) as BufferSource,
    });
  }
  const json = subscription.toJSON();
  await subscribePush({
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    },
    user_agent: navigator.userAgent,
  });
}

/** Remove the backend registration and drop the browser subscription. */
export async function disablePush(): Promise<void> {
  const subscription = await getPushSubscription();
  if (!subscription) return;
  const { endpoint } = subscription;
  try {
    await unsubscribePush(endpoint);
  } finally {
    await subscription.unsubscribe();
  }
}
