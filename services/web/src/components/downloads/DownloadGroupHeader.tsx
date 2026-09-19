import Badge from "@/components/ui/badge/Badge";

interface DownloadGroupHeaderProps {
  title: string;
  count: number;
}

export default function DownloadGroupHeader({
  title,
  count,
}: DownloadGroupHeaderProps) {
  return (
    <tr className="bg-gray-50 dark:bg-white/[0.04]">
      <td colSpan={5} className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-800 dark:text-white/90">
            {title}
          </span>
          <Badge size="sm" color="light">
            {count}
          </Badge>
        </div>
      </td>
    </tr>
  );
}
