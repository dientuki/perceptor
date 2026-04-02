import type { JobStatus } from "@prisma/client";

interface JobStatusBadgeProps {
  status?: JobStatus | null;
}

export default function JobStatusBadge({ status }: JobStatusBadgeProps) {
  if (!status || status === "CREATED") return null;

  const variantStyles =
    status === "COMPLETED"
      ? "bg-green-600 text-white"
      : status === "ERROR"
        ? "bg-red-600 text-white"
        : "animate-pulse bg-blue-600 text-white";

  return (
    <div className="absolute top-4 right-4 z-10">
      <span className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider shadow-lg ${variantStyles}`}>
        {status}
      </span>
    </div>
  );
}