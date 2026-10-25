import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProbedChapter {
  start_time?: string | number;
}

// Spec 103, REQ-10
export async function probeChapters(filePath: string): Promise<ProbedChapter[]> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_chapters',
    '-of', 'json',
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as { chapters?: ProbedChapter[] };
  return parsed.chapters ?? [];
}

// Spec 103, REQ-10
export function lastChapterStartMs(chapters: ProbedChapter[]): number | null {
  if (chapters.length < 2) return null;
  const seconds = Number(chapters[chapters.length - 1].start_time);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}
