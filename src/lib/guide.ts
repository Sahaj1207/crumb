"use client";
import { useMemo, useSyncExternalStore } from "react";

/**
 * First-run tour state, kept in this browser only (localStorage).
 * Steps tick themselves off when the visitor really does the thing.
 */
export type GuideStep = 1 | 2 | 3 | 4;
export type GuideState = {
  started: boolean;
  dismissed: boolean;
  open: boolean;
  done: GuideStep[];
  reservationId?: string;
  pickupCode?: string;
};

const KEY = "crumb.guide.v1";
const DEFAULT: GuideState = { started: false, dismissed: false, open: true, done: [] };
const listeners = new Set<() => void>();

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function parse(raw: string): GuideState {
  if (!raw) return DEFAULT;
  try {
    return { ...DEFAULT, ...(JSON.parse(raw) as Partial<GuideState>) };
  } catch {
    return DEFAULT;
  }
}

function write(patch: Partial<GuideState> | ((s: GuideState) => Partial<GuideState>)) {
  const current = parse(readRaw());
  const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  listeners.forEach((l) => l());
}

export function useGuide(): GuideState {
  const raw = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readRaw,
    () => "",
  );
  return useMemo(() => parse(raw), [raw]);
}

export const startGuide = () => write({ started: true, dismissed: false, open: true });
export const dismissGuide = () => write({ dismissed: true, open: false });
export const restartGuide = () => write({ ...DEFAULT, started: true });
export const setGuideOpen = (open: boolean) => write({ open });

/** Called by the real actions (publish, reserve, hand over, agent chat). */
export function markGuide(step: GuideStep, extra: Partial<Pick<GuideState, "reservationId" | "pickupCode">> = {}) {
  write((s) => ({ done: s.done.includes(step) ? s.done : [...s.done, step].sort(), ...extra }));
}

export const DEMO_PIN = "2468";
