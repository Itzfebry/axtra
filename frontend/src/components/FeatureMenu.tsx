"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MenuOrchestrator } from "@/components/MenuOrchestrator";
import type { OrchestratorAction, OrchestratorMenuEntry } from "@/lib/api";
import { FEATURES } from "@/lib/features";
import {
  DEFAULT_MENU_CONFIG,
  applyTheme,
  loadMenuConfig,
  loadOrchestratorState,
  saveMenuConfig,
  type MenuConfig,
} from "@/lib/menuConfig";

export function FeatureMenu() {
  const [config, setConfig] = useState<MenuConfig>(DEFAULT_MENU_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);

  // The server state wins when it exists: headless commands and Telegram wrote
  // it, so the sidebar must not overwrite it with this browser's localStorage.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await loadOrchestratorState();
      if (cancelled) return;
      if (state) {
        setConfig({ order: state.order, hidden: state.hidden, labels: state.labels });
        if (state.theme) applyTheme(state.theme);
      } else {
        setConfig(loadMenuConfig());
      }
      setConfigLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (configLoaded) saveMenuConfig(config);
  }, [config, configLoaded]);

  const menuPayload = useMemo<OrchestratorMenuEntry[]>(
    () =>
      FEATURES.map((feature) => ({
        id: feature.id,
        label: config.labels[feature.id] ?? feature.title,
        live: typeof feature.href === "string",
        href: feature.href ?? null,
        visible: !config.hidden.includes(feature.id),
      })),
    [config],
  );

  const handleActions = useCallback((actions: OrchestratorAction[]) => {
    setConfig((prev) => {
      let next: MenuConfig = {
        order: [...prev.order],
        hidden: [...prev.hidden],
        labels: { ...prev.labels },
      };
      for (const action of actions) {
        if (action.type === "menu_order" && action.order) {
          next = { ...next, order: action.order };
        } else if (action.type === "menu_visibility") {
          next = { ...next, hidden: action.hidden ?? [] };
        } else if (action.type === "menu_rename" && action.labels) {
          next = { ...next, labels: { ...next.labels, ...action.labels } };
        } else if (action.type === "reset_menu") {
          next = { ...DEFAULT_MENU_CONFIG };
        }
      }
      return next;
    });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MenuOrchestrator menu={menuPayload} onActions={handleActions} />
    </div>
  );
}