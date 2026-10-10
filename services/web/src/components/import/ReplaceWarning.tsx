"use client";

import { useTranslations } from "next-intl";

interface ReplaceWarningProps {
  /** The film title, or the `Show S01E02` label already built by each caller. */
  target: string;
}

// Spec 027, REQ-4
export default function ReplaceWarning({ target }: ReplaceWarningProps) {
  const t = useTranslations("import.replace");

  return (
    <div className="mb-4 rounded-lg border border-warning-500/30 bg-warning-50 px-4 py-3 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-400">
      <p>
        {t.rich("warning", {
          target,
          b: (chunks) => (
            <span className="font-medium text-gray-800 dark:text-white">
              {chunks}
            </span>
          ),
        })}
      </p>
    </div>
  );
}
