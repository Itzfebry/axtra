"use client";

import { useEffect, useState } from "react";

/**
 * Show a loading indicator only once loading lasts longer than `delay` ms.
 * Prevents a skeleton from flashing on fast responses while still giving
 * feedback for slow ones.
 */
export function useDelayedFlag(active: boolean, delay = 200): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [active, delay]);

  return visible;
}