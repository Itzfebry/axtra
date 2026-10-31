"use client";

import { techStackLogo } from "@/lib/techStack";

export function TechChip({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  const logo = techStackLogo(name);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-black ${className}`}
    >
      {logo && (
        // Remote brand icon from the Simple Icons CDN; next/image would need
        // a remotePatterns allow-list for a purely decorative 12px icon.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" aria-hidden className="h-3 w-3 shrink-0" loading="lazy" />
      )}
      {name}
    </span>
  );
}