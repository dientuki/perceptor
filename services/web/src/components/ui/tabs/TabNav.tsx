"use client";

import type { LucideIcon } from "lucide-react";

export interface TabNavItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

interface TabNavProps {
  items: TabNavItem[];
  active: string;
  onChange: (key: string) => void;
}

// Presentational only — no settings knowledge here. TailAdmin's "tabs with
// underline and icon" pattern: an active tab gets a brand-colored bottom
// border and text color, an inactive one is transparent/gray. The caller
// owns what "active" means and what happens on change.
export default function TabNav({ items, active, onChange }: TabNavProps) {
  return (
    <div className="border-b border-gray-200 dark:border-gray-800">
      <nav className="-mb-px flex flex-wrap gap-4" aria-label="Tabs">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.key === active;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium whitespace-nowrap ${
                isActive
                  ? "border-brand-500 text-brand-500"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
