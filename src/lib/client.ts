"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; pin?: string | null } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(init.pin ? { "x-shop-pin": init.pin } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status, json.code);
  return json as T;
}

/** Poll an endpoint while the tab is visible. */
export function usePoll<T>(path: string | null, ms = 4000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    if (!path) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, ms);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [path, ms, load]);
  return { data, error, reload: load };
}

export type AppConfig = { paypalMode: "sandbox" | "mock"; aiMode: "gemini" | "mock"; paypalClientId: string | null };
export function useConfig() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  useEffect(() => {
    api<AppConfig>("/api/config").then(setCfg).catch(() => {});
  }, []);
  return cfg;
}

const storeListeners = new Set<() => void>();
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A string remembered in this browser (falls back to the initial value if storage is blocked). */
export function useStored(key: string, initial = "") {
  const value = useSyncExternalStore(
    (cb) => {
      storeListeners.add(cb);
      return () => storeListeners.delete(cb);
    },
    () => readStored(key) ?? initial,
    () => initial,
  );
  const set = useCallback(
    (v: string) => {
      try {
        localStorage.setItem(key, v);
      } catch {}
      storeListeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set] as const;
}

/** Downscale a photo in the browser before upload (keeps AI calls fast and DB rows small). */
export async function fileToDataUrl(file: File, maxSide = 1024, quality = 0.82): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read that image"));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function minutesLeft(until: string | Date) {
  return Math.round((new Date(until).getTime() - Date.now()) / 60000);
}

export function timeLeftLabel(until: string | Date) {
  const m = minutesLeft(until);
  if (m <= 0) return "Pickup closed";
  if (m < 60) return `${m} min left to collect`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min left to collect`;
}
