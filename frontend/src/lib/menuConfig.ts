/** Per-browser menu configuration owned by the homepage orchestrator. */

import { apiFetch } from "@/lib/api";

export type MenuConfig = {
  /** Preferred feature id order. Empty means the built-in order. */
  order: string[];
  /** Feature ids the user asked Axtra to hide. */
  hidden: string[];
  /** Feature id -> custom label. */
  labels: Record<string, string>;
};

/** Menu config plus the theme Axtra/headless commands may have set. */
export type OrchestratorState = MenuConfig & { theme: "light" | "dark" | null };

export const DEFAULT_MENU_CONFIG: MenuConfig = {
  order: [],
  hidden: [],
  labels: {},
};

const STORAGE_KEY = "axtra-menu-config";
export const MENU_CONFIG_CHANGED = "axtra:menu-config-changed";

type ConfigurableFeature = { id: string; title: string };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function loadMenuConfig(): MenuConfig {
  if (typeof window === "undefined") return DEFAULT_MENU_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MENU_CONFIG;
    const parsed = JSON.parse(raw) as Partial<MenuConfig> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_MENU_CONFIG;
    const labels: Record<string, string> = {};
    if (parsed.labels && typeof parsed.labels === "object") {
      for (const [key, value] of Object.entries(parsed.labels)) {
        if (typeof value === "string" && value.trim()) labels[key] = value.trim();
      }
    }
    return {
      order: isStringArray(parsed.order) ? parsed.order : [],
      hidden: isStringArray(parsed.hidden) ? parsed.hidden : [],
      labels,
    };
  } catch {
    return DEFAULT_MENU_CONFIG;
  }
}

export function saveMenuConfig(config: MenuConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage may be unavailable (private mode); config is just not persisted.
  }
  // Server copy: what makes headless menu changes (API token / Telegram) land
  // in the sidebar on every device. Failures fall back to localStorage.
  void apiFetch<unknown>("/agent/state", {
    method: "PUT",
    body: JSON.stringify(config),
  }).catch(() => undefined);
  window.dispatchEvent(new Event(MENU_CONFIG_CHANGED));
}

/** Read the server-side menu/theme state written by the orchestrator or headless calls. */
export async function loadOrchestratorState(): Promise<OrchestratorState | null> {
  try {
    const state = await apiFetch<Partial<OrchestratorState>>("/agent/state");
    return {
      order: isStringArray(state.order) ? state.order : [],
      hidden: isStringArray(state.hidden) ? state.hidden : [],
      labels: state.labels && typeof state.labels === "object" ? state.labels : {},
      theme: state.theme === "dark" || state.theme === "light" ? state.theme : null,
    };
  } catch {
    return null; // offline or an older backend: localStorage stays the source
  }
}

/** Apply a theme and let the toggle re-read it without a reload. */
export function applyTheme(theme: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem("axtra-theme", theme);
  } catch {
    // Storage may be unavailable; theme still applies for this session.
  }
  window.dispatchEvent(new Event("axtra:theme-changed"));
}

export function applyMenuConfig<T extends ConfigurableFeature>(
  features: T[],
  config: MenuConfig,
): T[] {
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const ordered: T[] = [];
  for (const id of config.order) {
    const feature = byId.get(id);
    if (feature && !ordered.includes(feature)) ordered.push(feature);
  }
  for (const feature of features) {
    if (!ordered.includes(feature)) ordered.push(feature);
  }
  const hidden = new Set(config.hidden);
  return ordered
    .filter((feature) => !hidden.has(feature.id))
    .map((feature) => {
      const label = config.labels[feature.id];
      return label ? { ...feature, title: label } : feature;
    });
}