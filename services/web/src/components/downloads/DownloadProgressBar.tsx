import { formatProgress } from "@/lib/format";

interface DownloadProgressBarProps {
  progress: number | null;
}

export default function DownloadProgressBar({
  progress,
}: DownloadProgressBarProps) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
      <div className="h-2 w-full min-w-[6rem] overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className="h-full rounded-full bg-brand-500 transition-all"
          style={{ width: `${progress ?? 0}%` }}
        />
      </div>
      <span className="shrink-0 whitespace-nowrap text-xs">
        {formatProgress(progress)}
      </span>
    </div>
  );
}
