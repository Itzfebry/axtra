"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import type { SkillSummary } from "@/lib/api";

const STATUS_LABEL: Record<string, string> = {
  active: "aktif",
  draft: "draft",
  disabled: "nonaktif",
};

/**
 * Multi-select for assigning skills to one AI feature. Skills are grouped by
 * category and searchable; draft skills cannot be selected (the backend rejects
 * them) so they are shown disabled.
 */
export function SkillPicker({
  skills,
  selected,
  onChange,
}: {
  skills: SkillSummary[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = skills.filter(
      (skill) =>
        !q ||
        skill.name.toLowerCase().includes(q) ||
        skill.category.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q),
    );
    const map = new Map<string, SkillSummary[]>();
    for (const skill of filtered) {
      const key = skill.category || "general";
      const list = map.get(key) ?? [];
      list.push(skill);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [skills, query]);

  function toggle(id: string, checked: boolean) {
    if (checked) {
      onChange([...selected, id]);
    } else {
      onChange(selected.filter((item) => item !== id));
    }
  }

  if (skills.length === 0) {
    return (
      <p className="text-[12px] text-muted">
        Belum ada skill. Buat skill dulu di panel Kelola Skill.
      </p>
    );
  }

  const selectedSet = new Set(selected);

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <Search size={13} aria-hidden className="text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari skill..."
          aria-label="Cari skill"
          className="h-6 w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted"
        />
      </div>
      <div className="max-h-56 overflow-y-auto p-2">
        {groups.length === 0 && (
          <p className="px-1 py-2 text-[12px] text-muted">Tidak ada hasil.</p>
        )}
        {groups.map(([category, list]) => (
          <div key={category} className="mb-2 last:mb-0">
            <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted">
              {category}
            </p>
            <ul className="space-y-0.5">
              {list.map((skill) => {
                const disabled = skill.status === "draft";
                const checked = selectedSet.has(skill.id);
                return (
                  <li key={skill.id}>
                    <label
                      className={`flex items-start gap-2 rounded-md px-1 py-1 text-[12px] ${
                        disabled
                          ? "cursor-not-allowed opacity-50"
                          : "cursor-pointer hover:bg-surface-muted"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-foreground"
                        checked={checked}
                        disabled={disabled}
                        onChange={(event) => toggle(skill.id, event.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-foreground">
                            {skill.name}
                          </span>
                          {skill.status !== "active" && (
                            <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted">
                              {STATUS_LABEL[skill.status] ?? skill.status}
                            </span>
                          )}
                        </span>
                        {skill.description && (
                          <span className="block truncate text-[11px] text-muted">
                            {skill.description}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
