import type { Job } from 'bullmq';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  chown,
  lstat,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { SubtitleEmbedJob } from '../queue/types';
import {
  subtitleEmbedCompleted,
  subtitleEmbedDetails,
  subtitleEmbedFailed,
  subtitleEmbedStarted,
} from '../api/subtitle-embed-reports';
import { deliverReport } from '../api/deliver-report';
import { runFfmpegCapture } from '../ffmpeg/capture';
import { getMetadata } from '../ffmpeg/metadata';
import {
  ERROR_SUBTITLE_EMBED_NOT_WRITABLE,
  ERROR_SUBTITLE_EMBED_REMUX_FAILED,
  ERROR_SUBTITLE_EMBED_SIDECAR_DELETE_FAILED,
  ERROR_SUBTITLE_EMBED_SUBTITLE_UNREADABLE,
  ERROR_SUBTITLE_EMBED_VERIFY_FAILED,
} from '../i18n/error-keys';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import { buildEmbedArgs } from '../subtitles/embed-args';
import type { EmbedTrack } from '../subtitles/embed-args';
import { buildTrackTagsXml } from '../subtitles/embed-tags';
import { normalizeSrt } from '../subtitles/normalize-srt';
import { mayDeleteSidecar } from '../subtitles/sidecar-guard';
import { verifyEmbed } from '../subtitles/verify-embed';

const STDERR_TAIL_CHARS = 2000;

const detailOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

function keyed(key: string, params: Record<string, string>): KeyedError {
  return new KeyedError(key, renderMessage(key, params), params);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

// Spec 101, REQ-11
async function assertWritable(filePath: string, uid: number, gid: number): Promise<void> {
  const dir = dirname(filePath);
  try {
    await access(dir, constants.W_OK);
  } catch (err) {
    throw keyed(ERROR_SUBTITLE_EMBED_NOT_WRITABLE, { detail: detailOf(err) });
  }

  if (process.getuid?.() === uid) return;

  const probe = join(dir, `.${basename(filePath)}.perceptor-probe`);
  try {
    await writeFile(probe, '');
    await chown(probe, uid, gid);
  } catch (err) {
    throw keyed(ERROR_SUBTITLE_EMBED_NOT_WRITABLE, {
      detail: `cannot preserve the owner of the file: ${detailOf(err)}`,
    });
  } finally {
    await rm(probe, { force: true });
  }
}

// Spec 101, REQ-9
async function remux(args: string[], partPath: string): Promise<void> {
  let result;
  try {
    result = await runFfmpegCapture(args, new AbortController().signal, {
      binary: 'mkvmerge',
      keepStdout: true,
    });
  } catch (err) {
    throw keyed(ERROR_SUBTITLE_EMBED_REMUX_FAILED, {
      detail: `mkvmerge could not run: ${detailOf(err)}`.slice(-STDERR_TAIL_CHARS),
    });
  }

  const code = result.code;
  if ((code === 0 || code === 1) && (await isFile(partPath))) return;

  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  throw keyed(ERROR_SUBTITLE_EMBED_REMUX_FAILED, {
    detail: `mkvmerge failed with exit code ${code}: ${
      (combined || 'no output from mkvmerge').slice(-STDERR_TAIL_CHARS)
    }`,
  });
}

// Spec 101, REQ-12
async function deleteSidecars(sourcePaths: string[], filePath: string): Promise<string | null> {
  let warningKey: string | null = null;

  for (const sourcePath of sourcePaths) {
    try {
      if (!mayDeleteSidecar(sourcePath, filePath)) {
        throw new Error(`refusing to delete ${sourcePath}`);
      }
      const info = await lstat(sourcePath);
      if (!info.isFile()) throw new Error(`${sourcePath} is not a regular file`);
      await unlink(sourcePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      console.error(`[subtitle-embed] could not delete sidecar ${sourcePath}:`, err);
      warningKey = ERROR_SUBTITLE_EMBED_SIDECAR_DELETE_FAILED;
    }
  }

  return warningKey;
}

// Spec 101, REQ-9 REQ-10 REQ-11 REQ-12; Spec 103, REQ-11
export async function handleSubtitleEmbed(job: Job<SubtitleEmbedJob>): Promise<void> {
  const id = job.data.subtitleEmbedId;
  const details = await subtitleEmbedDetails(id);
  const filePath = details.filePath;
  const partPath = `${filePath}.part.mkv`;

  await rm(partPath, { force: true });

  const started = await subtitleEmbedStarted(id);
  if (!started) {
    console.log(`[subtitle-embed] ${id} no longer queued, reporting nothing`);
    return;
  }

  let tempDir: string | null = null;
  let renamed = false;

  try {
    const original = await stat(filePath).catch((err) => {
      throw keyed(ERROR_SUBTITLE_EMBED_NOT_WRITABLE, { detail: detailOf(err) });
    });
    await assertWritable(filePath, original.uid, original.gid);

    const { metadata: originalMetadata } = await getMetadata(filePath);

    tempDir = await mkdtemp(join(tmpdir(), 'perceptor-subtitle-embed-'));
    const embedTracks: EmbedTrack[] = [];
    for (const [n, track] of details.tracks.entries()) {
      let bytes: Buffer;
      try {
        bytes = await readFile(track.sourcePath);
      } catch (err) {
        throw keyed(ERROR_SUBTITLE_EMBED_SUBTITLE_UNREADABLE, {
          file: basename(track.sourcePath),
          detail: detailOf(err),
        });
      }
      const normalizedPath = join(tempDir, `${n}.srt`);
      await writeFile(normalizedPath, normalizeSrt(bytes, track.offsetMs, basename(track.sourcePath)));
      // Spec 107, REQ-14
      let tagsPath: string | undefined;
      if (track.provenance && track.provenance.trim() !== '') {
        tagsPath = join(tempDir, `${n}.tags.xml`);
        await writeFile(tagsPath, buildTrackTagsXml(track.provenance, track.offsetMs));
      }
      embedTracks.push({
        normalizedPath,
        tagsPath,
        languageIso3: track.languageIso3,
        trackTitle: track.trackTitle,
        isDefault: track.isDefault,
        isForced: track.isForced,
      });
    }

    await remux(
      buildEmbedArgs({
        originalPath: filePath,
        partPath,
        originalStreams: originalMetadata.streams ?? [],
        tracks: embedTracks,
      }),
      partPath,
    );

    const { metadata: resultMetadata } = await getMetadata(partPath);
    const verdict = verifyEmbed(originalMetadata, resultMetadata, embedTracks);
    if (!verdict.ok) {
      throw keyed(ERROR_SUBTITLE_EMBED_VERIFY_FAILED, { detail: verdict.reason });
    }

    await chmod(partPath, original.mode & 0o7777);
    try {
      await chown(partPath, original.uid, original.gid);
    } catch (err) {
      if (process.getuid?.() !== original.uid) {
        throw keyed(ERROR_SUBTITLE_EMBED_NOT_WRITABLE, {
          detail: `cannot preserve the owner of the file: ${detailOf(err)}`,
        });
      }
    }

    await rename(partPath, filePath);
    renamed = true;
  } catch (err) {
    await rm(partPath, { force: true }).catch(() => undefined);
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    console.error(`[subtitle-embed] ${id} failed:`, err);

    const key =
      err instanceof KeyedError ? err.key : ERROR_SUBTITLE_EMBED_REMUX_FAILED;
    await deliverReport(`subtitleEmbedFailed(${id})`, () => subtitleEmbedFailed(id, key));
    return;
  }

  let warningKey: string | null = null;
  try {
    if (renamed) {
      warningKey = await deleteSidecars(
        details.tracks.filter((track) => track.isSidecar !== false).map((track) => track.sourcePath),
        filePath,
      );
    }
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }

  await deliverReport(`subtitleEmbedCompleted(${id})`, () =>
    subtitleEmbedCompleted(id, warningKey),
  );
}
