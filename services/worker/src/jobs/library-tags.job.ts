import type { Job } from 'bullmq';
import { execFile } from 'node:child_process';
import { access, constants, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LibraryTagsJob } from '../queue/types';
import {
  libraryTagMigrationItem,
  libraryTagMigrationItemFinished,
} from '../api/library-tags-reports';
import type {
  LibraryTagMigrationItemDetails,
  LibraryTagWorkerOutcome,
} from '../api/library-tags-reports';
import { deliverReport } from '../api/deliver-report';
import { getMetadata } from '../ffmpeg/metadata';
import { KeyedError } from '../i18n/keyed-error';
import {
  ERROR_LIBRARY_TAGS_FILE_MISSING,
  ERROR_LIBRARY_TAGS_ITEM_NOT_FOUND,
  ERROR_LIBRARY_TAGS_ITEM_SETTLED,
  ERROR_LIBRARY_TAGS_VERIFY_FAILED,
  ERROR_LIBRARY_TAGS_WRITE_FAILED,
} from '../i18n/error-keys';
import { mergeLibraryTags } from '../tags/merge-library-tags';
import type { LibraryTrack, MigrationFacts } from '../tags/merge-library-tags';

const EMPTY_TAGS_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<Tags>\n</Tags>\n';
const TOOL_BUFFER_BYTES = 64 * 1024 * 1024;

type ToolResult = { code: number; stdout: string; stderr: string };

function runTool(binary: string, args: string[]): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { maxBuffer: TOOL_BUFFER_BYTES }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
        return;
      }
      const code = (error as NodeJS.ErrnoException & { code?: unknown }).code;
      if (typeof code === 'number') {
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        return;
      }
      reject(error);
    });
  });
}

// Spec 123, NFR-4
function fingerprint(metadata: {
  format?: { duration?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    duration?: string;
    tags?: Record<string, string>;
  }>;
}): string {
  const streams = (metadata.streams ?? []).map((s) => [
    s.codec_type ?? null,
    s.codec_name ?? null,
    s.duration ?? null,
    s.tags?.language ?? null,
    s.tags?.title ?? null,
  ]);
  return JSON.stringify({ duration: metadata.format?.duration ?? null, streams });
}

function toFacts(d: LibraryTagMigrationItemDetails): MigrationFacts {
  return {
    encodedAt: d.encodedAt ? new Date(d.encodedAt) : null,
    videoCodec: d.videoCodec,
    crf: d.crf,
    preset: d.preset,
    contentKind: d.contentKind,
    resolutionCeiling: d.resolutionCeiling,
    outputResolution: d.outputResolution,
    grainApplied: d.grainApplied,
    deinterlaced: d.deinterlaced,
    dubTrimSeconds: d.dubTrimSeconds,
    streamEndTrimSeconds: d.streamEndTrimSeconds,
    tracks: d.tracks.map((t) => ({
      source: t.source,
      provider: t.provider,
      syncScore: t.syncScore,
      framerateRatio: t.framerateRatio,
      embeddedAt: t.embeddedAt ? new Date(t.embeddedAt) : null,
    })),
  };
}

function outputResolution(metadata: {
  streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
}): string | null {
  const v = (metadata.streams ?? []).find((s) => s.codec_type === 'video');
  return v?.width && v.height ? `${v.width}x${v.height}` : null;
}

// Spec 123, REQ-14 REQ-16 NFR-1 NFR-4
export async function handleLibraryTags(job: Job<LibraryTagsJob>): Promise<void> {
  const { itemId } = job.data;
  const label = `library-tags ${itemId}`;

  let details: LibraryTagMigrationItemDetails;
  try {
    details = await libraryTagMigrationItem(itemId);
  } catch (err) {
    if (
      err instanceof KeyedError &&
      (err.key === ERROR_LIBRARY_TAGS_ITEM_NOT_FOUND || err.key === ERROR_LIBRARY_TAGS_ITEM_SETTLED)
    ) {
      console.log(`[library-tags] ${label}: ${err.key}, reporting nothing`);
      return;
    }
    throw err;
  }

  const { filePath } = details;
  const report = async (outcome: LibraryTagWorkerOutcome, reasonKey: string | null) => {
    await deliverReport(`libraryTagMigrationItemFinished(${itemId})`, () =>
      libraryTagMigrationItemFinished(itemId, outcome, reasonKey),
    );
  };

  try {
    await access(filePath, constants.F_OK);
  } catch {
    console.log(`[library-tags] ${label}: ${filePath} is missing`);
    await report('MISSING', ERROR_LIBRARY_TAGS_FILE_MISSING);
    return;
  }

  let tempDir: string | null = null;
  try {
    let before: string;
    let beforeMetadata: Parameters<typeof outputResolution>[0];
    try {
      await access(filePath, constants.R_OK | constants.W_OK);
      const probed = await getMetadata(filePath);
      beforeMetadata = probed.metadata;
      before = fingerprint(probed.metadata);
    } catch (err) {
      console.error(`[library-tags] ${label}: ${filePath} is not readable and writable:`, err);
      await report('FAILED', ERROR_LIBRARY_TAGS_WRITE_FAILED);
      return;
    }

    tempDir = await mkdtemp(join(tmpdir(), 'perceptor-library-tags-'));
    const extracted = join(tempDir, 'extracted.xml');
    const replacement = join(tempDir, 'replacement.xml');

    let tagsXml: string;
    let tracks: LibraryTrack[];
    try {
      const extract = await runTool('mkvextract', [filePath, 'tags', extracted]);
      if (extract.code > 1) {
        throw new Error(`mkvextract exited with ${extract.code}: ${extract.stderr.slice(-500)}`);
      }
      tagsXml = await readFile(extracted, 'utf8').catch(() => '');
      if (tagsXml.trim() === '') tagsXml = EMPTY_TAGS_XML;

      const identify = await runTool('mkvmerge', ['-J', filePath]);
      if (identify.code > 1) {
        throw new Error(`mkvmerge -J exited with ${identify.code}: ${identify.stderr.slice(-500)}`);
      }
      const parsed = JSON.parse(identify.stdout.replace(/("uid"\s*:\s*)(\d+)/g, '$1"$2"')) as {
        tracks?: Array<{ type?: string; properties?: { number?: number; uid?: number } }>;
      };
      tracks = (parsed.tracks ?? []).flatMap((t) =>
        typeof t.properties?.number === 'number' && typeof t.properties.uid === 'string'
          ? [{ number: t.properties.number, uid: t.properties.uid, type: t.type ?? '' }]
          : [],
      );
    } catch (err) {
      console.error(`[library-tags] ${label}: reading the tags of ${filePath} failed:`, err);
      await report('FAILED', ERROR_LIBRARY_TAGS_WRITE_FAILED);
      return;
    }

    const merged = mergeLibraryTags({
      tagsXml,
      tracks,
      facts: toFacts(details),
      probedOutputResolution: outputResolution(beforeMetadata),
    });
    if (merged === 'unchanged') {
      await report('UNCHANGED', null);
      return;
    }

    await writeFile(replacement, merged, 'utf8');
    try {
      const edit = await runTool('mkvpropedit', [filePath, '--tags', `all:${replacement}`]);
      if (edit.code !== 0) {
        throw new Error(`mkvpropedit exited with ${edit.code}: ${edit.stderr.slice(-500)}`);
      }
    } catch (err) {
      console.error(`[library-tags] ${label}: rewriting ${filePath} failed:`, err);
      await report('FAILED', ERROR_LIBRARY_TAGS_WRITE_FAILED);
      return;
    }

    let after: string;
    try {
      after = fingerprint((await getMetadata(filePath)).metadata);
    } catch (err) {
      console.error(`[library-tags] ${label}: re-probing ${filePath} failed:`, err);
      after = '';
    }
    if (after !== before) {
      console.error(`[library-tags] ${label}: ${filePath} differs after the tag rewrite, not writing again`);
      await report('FAILED', ERROR_LIBRARY_TAGS_VERIFY_FAILED);
      return;
    }

    await report('MIGRATED', null);
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}
