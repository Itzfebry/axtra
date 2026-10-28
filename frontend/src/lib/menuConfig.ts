/** Per-browser menu configuration owned by the homepage orchestrator. */

export type MenuConfig = {
  /** Preferred feature id order. Empty means the built-in order. */
  order: string[];
  /** Feature ids the user asked Axtra to hide. */
  hidden: string[];
  /** Feature id -> custom label. */
  labels: Record<string, string>;
};

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
  window.dispatchEvent(new Event(MENU_CONFIG_CHANGED));
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