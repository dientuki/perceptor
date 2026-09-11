export function formatSpeed(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) return "—";
  if (bytesPerSecond === 0) return "0 B/s";
  const k = 1024;
  const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytesPerSecond / k ** index).toFixed(1))} ${sizes[index]}`;
}

export function formatProgress(progress: number | null): string {
  // progress arrives 0..100 already — do not multiply by 100 again.
  if (progress === null) return "—";
  return `${parseFloat(progress.toFixed(1))}%`;
}

export function formatEncodeSpeed(speed: number | null): string {
  // A dimensionless multiplier (e.g. FFmpeg's own "1.23x") — never route
  // through formatSpeed's B/s ladder. 0 is a real value at the start of an
  // encode, not an absence.
  if (speed === null) return "—";
  return `${speed.toFixed(2)}x`;
}
