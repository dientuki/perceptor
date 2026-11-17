type Props = {
  codes: string[] | null;
  variant: "boxes" | "compact";
};

export default function LanguageChips({ codes, variant }: Props) {
  const compact = variant === "compact";

  if (codes === null || codes.length === 0) {
    return <span className="text-gray-400 dark:text-gray-500">—</span>;
  }

  const chipClass = compact
    ? "rounded bg-gray-100 px-1 py-0.5 text-xs font-medium text-gray-700 dark:bg-white/[0.05] dark:text-gray-300"
    : "rounded-md bg-gray-100 px-2 py-0.5 text-sm font-medium text-gray-700 dark:bg-white/[0.05] dark:text-gray-300";

  return (
    <span className={compact ? "flex gap-1" : "flex flex-wrap gap-1"}>
      {codes.map((code) => (
        <span key={code} className={chipClass}>
          {code.toUpperCase()}
        </span>
      ))}
    </span>
  );
}
