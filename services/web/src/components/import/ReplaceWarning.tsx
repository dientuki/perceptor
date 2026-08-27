"use client";

import { useTranslations } from "next-intl";

interface ReplaceWarningProps {
  /** The film title, or the `Show S01E02` label already built by each caller. */
  target: string;
}

/**
 * The one warning block every replacement entry point shares (REQ-4): the
 * file already in the library is about to be replaced, and the old one
 * deleted. Purely presentational — the confirm control stays with each
 * caller, since a form button, a per-row button and a file input each own a
 * differently-shaped submit. Rendered inline, never through
 * `window.confirm()` (services/web/CLAUDE.md § Small conventions).
 */
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
