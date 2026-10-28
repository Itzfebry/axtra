"use client";

/**
 * Small client-side bridge between the homepage orchestrator and the rest of
 * the app: hand off a prompt to a chat mode and highlight a sidebar tool.
 */

const PENDING_PROMPT_KEY = "axtra-pending-prompt";
export const MENU_FOCUS_EVENT = "axtra:menu-focus";

type PendingPrompt = { mode: string; prompt: string };

/** Remember a prompt to auto-send once the target chat mode mounts. */
export function queuePrompt(mode: string, prompt: string): void {
  if (typeof window === "undefined" || !prompt.trim()) return;
  try {
    window.sessionStorage.setItem(
      PENDING_PROMPT_KEY,
      JSON.stringify({ mode, prompt } satisfies PendingPrompt),
    );
  } catch {
    // Storage may be unavailable; the prompt is simply dropped.
  }
}

/** Consume the queued prompt if it targets the given mode. */
export function takePrompt(mode: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_PROMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingPrompt;
    // Leave prompts for other modes in place: the owning panel still needs them.
    if (parsed.mode !== mode || !parsed.prompt) return null;
    window.sessionStorage.removeItem(PENDING_PROMPT_KEY);
    return parsed.prompt;
  } catch {
    return null;
  }
}

/** Ask the sidebar to reveal and flash a menu item. */
export function focusMenu(target: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MENU_FOCUS_EVENT, { detail: { target } }));
}
