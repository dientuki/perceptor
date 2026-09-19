export type StatusTone = "completed" | "progress" | "error" | "missing";

export function statusTone(status: string): StatusTone {
  switch (status) {
    case "COMPLETED":
      return "completed";
    case "ERROR":
      return "error";
    case "QUEUED":
    case "PAUSED":
    case "DOWNLOADING":
    case "DOWNLOADED":
    case "ENCODING":
      return "progress";
    default:
      return "missing";
  }
}
