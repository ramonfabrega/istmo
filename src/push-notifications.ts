import { useState } from "react";
import { api, safeRead, safeWrite } from "./api";
const post = <T>(route: string, data: unknown) =>
  api<T>("/api/push/" + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
export function usePushNotifications() {
  const [source, setSource] = useState(safeRead("istmo-push-source", "up"));
  const [mag, setMag] = useState(safeRead("istmo-push-mag", 4));
  const [device, setDevice] = useState<{ id: string; token: string } | null>(
    safeRead("istmo-push-device", null),
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const supported =
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error(
          "Notifications were not allowed. You can change this in browser settings.",
        );
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;
      const config = await api<{ publicKey: string }>("/api/push/config");
      if (!config.publicKey)
        throw new Error("Server notification keys are not configured.");
      const key = Uint8Array.from(
        atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/")),
        (c) => c.charCodeAt(0),
      );
      const subscription =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        }));
      const next = await post<{ id: string; token: string }>("subscribe", {
        subscription: subscription.toJSON(),
        source,
        minMagnitude: mag,
        token: device?.token,
      });
      setDevice(next);
      safeWrite("istmo-push-device", next);
      safeWrite("istmo-push-source", source);
      safeWrite("istmo-push-mag", mag);
      setMessage("Saved. New qualifying reports will be sent to this device.");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!device) return;
    setBusy(true);
    try {
      await post("unsubscribe", device);
      safeWrite("istmo-push-device", null);
      setDevice(null);
      setMessage("Device notifications are off.");
      const registration = await navigator.serviceWorker.getRegistration();
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    if (!device) return;
    setBusy(true);
    try {
      await post("test", device);
      setMessage("Test queued. Check this device for a notification.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  return {
    source,
    setSource,
    magnitude: mag,
    setMagnitude: setMag,
    enabled: Boolean(device),
    message,
    busy,
    supported,
    enable,
    disable,
    test,
  };
}
