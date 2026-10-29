"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Thin top bar shown while an in-app link navigates. Starts on a normal
 * left-click of an internal link and clears once the pathname changes, so
 * users get feedback during route/chunk loading that skeletons cannot cover.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const fallback = useRef<number | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("http") ||
        anchor.target === "_blank" ||
        href === window.location.pathname
      ) {
        return;
      }
      setActive(true);
      if (fallback.current !== null) window.clearTimeout(fallback.current);
      // Safety net: never leave the bar stuck if navigation is cancelled.
      fallback.current = window.setTimeout(() => setActive(false), 8000);
    }

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      if (fallback.current !== null) window.clearTimeout(fallback.current);
    };
  }, []);

  useEffect(() => {
    setActive(false);
    if (fallback.current !== null) {
      window.clearTimeout(fallback.current);
      fallback.current = null;
    }
  }, [pathname]);

  if (!active) return null;

  return (
    <div
      role="progressbar"
      aria-label="Memuat halaman"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden"
    >
      <div className="h-full w-1/3 animate-nav-progress bg-foreground/70" />
    </div>
  );
}