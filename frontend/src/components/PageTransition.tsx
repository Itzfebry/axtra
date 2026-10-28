"use client";

import { usePathname } from "next/navigation";

/**
 * Wraps page content and replays a short fade/slide whenever the top-level
 * route segment changes, so navigation feels smooth instead of abrupt.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Only remount on the first segment, so switching between sibling routes
  // (e.g. /chat/a -> /chat/b) keeps their internal state.
  const segment = pathname.split("/")[1] ?? "";

  return (
    <div key={segment} className="animate-page-in flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}
