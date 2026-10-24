export type FfsubsyncResult = {
  offsetMs: number;
  framerateRatio: number;
  score: number;
};

const NUMBER = '(-?\\d+(?:\\.\\d+)?)';
const SCORE = new RegExp(`INFO\\s+score:\\s*${NUMBER}`);
const OFFSET = new RegExp(`INFO\\s+offset seconds:\\s*${NUMBER}`);
const RATIO = new RegExp(`INFO\\s+framerate scale factor:\\s*${NUMBER}`);

// Spec 103, T015
export function parseFfsubsyncOutput(log: string): FfsubsyncResult | null {
  const score = SCORE.exec(log);
  const offset = OFFSET.exec(log);
  const ratio = RATIO.exec(log);
  if (!score || !offset || !ratio) return null;

  const result = {
    offsetMs: Math.round(Number(offset[1]) * 1000),
    framerateRatio: Number(ratio[1]),
    score: Number(score[1]),
  };
  if (!Number.isFinite(result.offsetMs) || !Number.isFinite(result.framerateRatio) || !Number.isFinite(result.score)) {
    return null;
  }
  return result;
}
