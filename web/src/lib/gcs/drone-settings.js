import { useCallback, useSyncExternalStore } from "react";

export const DRONE_SETTINGS_KEY = "soerogis:drone-settings";
const SETTINGS_EVENT = "soerogis:drone-settings-changed";

export const DEFAULT_POLL_INTERVAL_MS = 3000;
export const MIN_POLL_INTERVAL_MS = 500;
export const MAX_POLL_INTERVAL_MS = 120000;

const DEFAULT = {
  baseUrl: "",
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
};

export function normalizeBaseUrl(value = "") {
  return String(value)
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\s+/g, "");
}

function clampInterval(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return DEFAULT.pollIntervalMs;
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, Math.round(ms)));
}

function parse(raw) {
  if (!raw) return DEFAULT;
  try {
    const data = JSON.parse(raw);
    return {
      baseUrl: normalizeBaseUrl(data.baseUrl),
      pollIntervalMs: clampInterval(data.pollIntervalMs),
    };
  } catch {
    return DEFAULT;
  }
}

export function getDroneSettings() {
  if (typeof window === "undefined") return DEFAULT;
  return parse(window.localStorage.getItem(DRONE_SETTINGS_KEY));
}

export function setDroneSettings(patch) {
  const current = getDroneSettings();
  const next = {
    baseUrl: normalizeBaseUrl(patch.baseUrl ?? current.baseUrl),
    pollIntervalMs: clampInterval(patch.pollIntervalMs ?? current.pollIntervalMs),
  };
  window.localStorage.setItem(DRONE_SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(SETTINGS_EVENT));
  return next;
}

export function droneAddrHeaders() {
  const { baseUrl } = getDroneSettings();
  return baseUrl ? { "x-drone-addr": baseUrl } : {};
}

function subscribe(callback) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event) => {
    if (event.key === null || event.key === DRONE_SETTINGS_KEY) callback();
  };
  window.addEventListener(SETTINGS_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SETTINGS_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

let cachedRaw = null;
let cached = DEFAULT;

function snapshot() {
  if (typeof window === "undefined") return DEFAULT;
  const raw = window.localStorage.getItem(DRONE_SETTINGS_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parse(raw);
  }
  return cached;
}

export function useDroneSettings() {
  const settings = useSyncExternalStore(subscribe, snapshot, () => DEFAULT);
  const update = useCallback((patch) => setDroneSettings(patch), []);
  return [settings, update];
}
