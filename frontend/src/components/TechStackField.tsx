"use client";

import { useMemo, useState } from "react";

import { TechChip } from "@/components/TechChip";
import { searchTechStack, techStackLogo } from "@/lib/techStack";

type Props = {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
};

function selectedNames(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function TechStackField({
  id,
  value,
  onChange,
  className = "",
  placeholder = "Next.js, FastAPI",
}: Props) {
  const [open, setOpen] = useState(false);

  const query = useMemo(() => {
    const parts = value.split(",");
    return parts[parts.length - 1].trim();
  }, [value]);

  const chosen = useMemo(
    () => new Set(selectedNames(value).map((name) => name.toLowerCase())),
    [value],
  );

  const suggestions = useMemo(() => {
    if (!query) return [];
    return searchTechStack(query, 8).filter(
      (item) => !chosen.has(item.name.toLowerCase()),
    );
  }, [query, chosen]);

  function pick(name: string) {
    const parts = value.split(",");
    parts[parts.length - 1] = name;
    onChange(`${parts.map((part) => part.trim()).filter(Boolean).join(", ")}, `);
    setOpen(true);
  }

  const names = selectedNames(value);

  return (
    <div className="relative">
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
      />

      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {suggestions.map((item) => (
            <li key={item.name}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(item.name)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground transition-colors duration-150 hover:bg-surface-muted"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={techStackLogo(item.name) ?? ""}
                  alt=""
                  aria-hidden
                  className="h-4 w-4 shrink-0"
                  loading="lazy"
                />
                {item.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {names.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {names.map((name) => (
            <TechChip key={name} name={name} />
          ))}
        </div>
      )}
    </div>
  );
}