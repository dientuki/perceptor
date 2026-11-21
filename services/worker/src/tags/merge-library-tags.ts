import { buildGlobalGroup, buildTrackGroup, buildVideoGroup, type PerceptorNode, type VideoTagFacts } from './perceptor-tags';

// Spec 123, REQ-14
export type MigrationTrackFacts = {
  source: string;
  provider?: string | null;
  syncScore?: number | null;
  framerateRatio?: number | null;
  embeddedAt?: Date | null;
};

// Spec 123, REQ-14
export type MigrationFacts = {
  encodedAt?: Date | null;
  videoCodec?: string | null;
  crf?: number | null;
  preset?: number | null;
  contentKind?: string | null;
  resolutionCeiling?: string | null;
  outputResolution?: string | null;
  grainApplied?: boolean | null;
  deinterlaced?: boolean | null;
  dubTrimSeconds?: number | null;
  streamEndTrimSeconds?: number | null;
  tracks: MigrationTrackFacts[];
};

// Spec 123, REQ-14
export type LibraryTrack = { number: number; uid: string; type: string };

export type MergeInput = {
  tagsXml: string;
  tracks: LibraryTrack[];
  facts: MigrationFacts;
  probedOutputResolution?: string | null;
};

type El = {
  name: string;
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
};

type Edit = { start: number; end: number; text: string };

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z][\w.-]*)[^>]*?(\/?)>/g;

function children(src: string, from: number, to: number): El[] {
  const out: El[] = [];
  const stack: { name: string; start: number; innerStart: number }[] = [];
  TOKEN.lastIndex = from;
  for (let m = TOKEN.exec(src); m && m.index < to; m = TOKEN.exec(src)) {
    if (m[2] === undefined) continue;
    const end = m.index + m[0].length;
    if (m[1] === '/') {
      const open = stack.pop();
      if (open && stack.length === 0) {
        out.push({ name: open.name, start: open.start, end, innerStart: open.innerStart, innerEnd: m.index });
      }
    } else if (m[3] === '/') {
      if (stack.length === 0) out.push({ name: m[2], start: m.index, end, innerStart: end, innerEnd: end });
    } else {
      stack.push({ name: m[2], start: m.index, innerStart: end });
    }
  }
  return out;
}

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

type Simple = El & {
  tagName: string;
  value: string | null;
  raw: string | null;
  strStart: number;
  kids: Simple[];
};

function simples(src: string, from: number, to: number): Simple[] {
  return children(src, from, to)
    .filter((el) => el.name === 'Simple')
    .map((el) => {
      const parts = children(src, el.innerStart, el.innerEnd);
      const nameEl = parts.find((p) => p.name === 'Name');
      const stringEl = parts.find((p) => p.name === 'String');
      return {
        ...el,
        tagName: nameEl ? decode(src.slice(nameEl.innerStart, nameEl.innerEnd)).trim() : '',
        value: stringEl ? decode(src.slice(stringEl.innerStart, stringEl.innerEnd)) : null,
        raw: stringEl ? src.slice(stringEl.innerStart, stringEl.innerEnd) : null,
        strStart: stringEl ? stringEl.innerStart : -1,
        kids: simples(src, el.innerStart, el.innerEnd),
      };
    });
}

function renderNode(node: PerceptorNode, indent: string): string[] {
  const lines = [`${indent}<Simple>`, `${indent}  <Name>${node.name}</Name>`];
  if (node.value !== undefined) lines.push(`${indent}  <String>${node.value}</String>`);
  for (const child of node.children ?? []) lines.push(...renderNode(child, `${indent}  `));
  lines.push(`${indent}</Simple>`);
  return lines;
}

function renderBlock(nodes: PerceptorNode[], indent: string): string {
  return nodes.flatMap((node) => renderNode(node, indent)).join('\n');
}

function lineIndent(src: string, start: number): string {
  const prefix = src.slice(src.lastIndexOf('\n', start - 1) + 1, start);
  return /^[ \t]*$/.test(prefix) ? prefix : '';
}

function removal(src: string, el: El): Edit {
  const lineStart = src.lastIndexOf('\n', el.start - 1) + 1;
  const alone = /^[ \t]*$/.test(src.slice(lineStart, el.start));
  const after = /^[ \t]*\r?\n/.exec(src.slice(el.end));
  if (alone && after) return { start: lineStart, end: el.end + after[0].length, text: '' };
  return { start: el.start, end: el.end, text: '' };
}

function replacement(src: string, el: El, nodes: PerceptorNode[]): Edit {
  const indent = lineIndent(src, el.start);
  return { start: el.start, end: el.end, text: renderBlock(nodes, indent).slice(indent.length) };
}

function insertionBeforeClose(src: string, el: El, nodes: PerceptorNode[]): Edit {
  const closeIndent = lineIndent(src, el.innerEnd);
  const indent = `${closeIndent}  `;
  const body = renderBlock(nodes, indent);
  if (closeIndent !== '' || src[el.innerEnd - 1] === '\n') {
    const at = el.innerEnd - closeIndent.length;
    return { start: at, end: at, text: `${body}\n` };
  }
  return { start: el.innerEnd, end: el.innerEnd, text: `\n${body}\n` };
}

function flatValue(list: Simple[], name: string, raw = false): string | null {
  const hit = list.find((s) => s.tagName === name && s.value !== null && s.value.trim() !== '');
  return hit ? ((raw ? hit.raw : hit.value) as string) : null;
}

function missing(wanted: PerceptorNode[], present: Simple[]): PerceptorNode[] {
  const have = new Set(present.map((s) => s.tagName));
  return wanted.filter((node) => !have.has(node.name));
}

// Spec 123, REQ-20
const LEGACY_GLOBAL_CHILDREN = new Set(['ENCODE', 'GRAIN', 'DUB_TRIM', 'STREAM_END_TRIM']);

// Spec 123, REQ-20
function movedFromLegacy(legacy: Simple[]): PerceptorNode[] {
  const out: PerceptorNode[] = [];
  const keep = (name: string, raw: string | null) => {
    if (raw !== null && raw.trim() !== '') out.push({ name, value: raw });
  };
  for (const node of legacy) {
    if (node.tagName === 'ENCODE') for (const k of node.kids) keep(k.tagName, k.raw);
    else if (node.tagName === 'GRAIN') for (const k of node.kids) {
      if (k.tagName === 'APPLIED') keep('GRAIN_APPLIED', k.raw);
      else if (k.tagName === 'DECIDED_BY') keep('GRAIN_DECIDED_BY', k.raw);
    }
    else keep(node.tagName, node.raw);
  }
  return out;
}

// Spec 123, REQ-14 REQ-15
function videoFacts(input: MergeInput, withProbe: boolean): VideoTagFacts {
  const f = input.facts;
  const codec = f.videoCodec === 'av1' || f.videoCodec === 'copy' ? f.videoCodec : null;
  return {
    videoCodec: codec,
    crf: f.crf,
    preset: f.preset,
    contentKind: f.contentKind,
    resolutionCeiling: f.resolutionCeiling,
    outputResolution: withProbe ? (input.probedOutputResolution ?? f.outputResolution) : f.outputResolution,
    deinterlaced: f.deinterlaced,
    grainApplied: f.grainApplied,
  };
}

// Spec 123, REQ-20
function stripProvider(source: string, provider: string | null | undefined): string {
  const p = provider?.trim().toLowerCase();
  if (!p) return source.trim();
  const trimmed = source.trim();
  return trimmed.toLowerCase().startsWith(`${p}:`) ? trimmed.slice(p.length + 1) : trimmed;
}

function tagBlock(targets: string, nodes: PerceptorNode[]): string {
  return `${['  <Tag>', `    ${targets}`, renderBlock(nodes, '    '), '  </Tag>'].join('\n')}\n`;
}

// Spec 123, REQ-14 REQ-16 REQ-20
export function mergeLibraryTags(input: MergeInput): string | 'unchanged' {
  const src = input.tagsXml;
  const root = children(src, 0, src.length).find((el) => el.name === 'Tags');
  const tagEls = root ? children(src, root.innerStart, root.innerEnd).filter((el) => el.name === 'Tag') : [];

  const parsed = tagEls.map((tag) => {
    const targets = children(src, tag.innerStart, tag.innerEnd).find((el) => el.name === 'Targets');
    const uids = targets
      ? children(src, targets.innerStart, targets.innerEnd)
          .filter((el) => el.name === 'TrackUID')
          .map((el) => src.slice(el.innerStart, el.innerEnd).trim())
      : [];
    const hasOtherUid = targets
      ? children(src, targets.innerStart, targets.innerEnd).some((el) => /UID$/.test(el.name) && el.name !== 'TrackUID')
      : false;
    return { tag, uids, global: uids.length === 0 && !hasOtherUid, list: simples(src, tag.innerStart, tag.innerEnd) };
  });

  const edits: Edit[] = [];
  const newTags: string[] = [];

  const globalTags = parsed.filter((p) => p.global);
  const globalList = globalTags.flatMap((p) => p.list);
  const flats = globalList.filter((s) => s.tagName === 'PERCEPTOR_SOURCE');
  const group = globalList.find((s) => s.tagName === 'PERCEPTOR');
  const source = flatValue(globalList, 'PERCEPTOR_SOURCE');

  const videoTrack = input.tracks.find((t) => t.type === 'video');
  const videoUid: string | undefined = videoTrack?.uid;
  const legacy = group && videoUid !== undefined ? group.kids.filter((k) => LEGACY_GLOBAL_CHILDREN.has(k.tagName)) : [];
  const moved = movedFromLegacy(legacy);
  const converting = flats.length > 0 || legacy.length > 0;

  const globalWanted = buildGlobalGroup({ source, version: null, encodedAt: input.facts.encodedAt });

  if (group) {
    for (const flat of flats) edits.push(removal(src, flat));
    const wanted = flats.length > 0 ? missing(globalWanted[0]?.children ?? [], group.kids) : [];
    if (legacy.length > 0 && legacy.length === group.kids.length && wanted.length === 0) {
      edits.push(removal(src, group));
    } else {
      for (const node of legacy) edits.push(removal(src, node));
      if (wanted.length > 0) edits.push(insertionBeforeClose(src, group, wanted));
    }
  } else if (globalWanted.length > 0) {
    const [first, ...rest] = flats;
    if (first) {
      edits.push(replacement(src, first, globalWanted));
      for (const flat of rest) edits.push(removal(src, flat));
    } else if (globalTags[0]) {
      edits.push(insertionBeforeClose(src, globalTags[0].tag, globalWanted));
    } else {
      newTags.push(tagBlock('<Targets/>', globalWanted));
    }
  }

  if (videoUid !== undefined) {
    const vTag = parsed.find((p) => p.uids.includes(videoUid));
    const vGroup = vTag?.list.find((s) => s.tagName === 'PERCEPTOR');
    const movedNames = new Set(moved.map((n) => n.name));
    const build = (withProbe: boolean): PerceptorNode[] => [
      ...moved,
      ...(buildVideoGroup(videoFacts(input, withProbe))[0]?.children ?? []).filter((n) => !movedNames.has(n.name)),
    ];
    if (vGroup) {
      if (converting) {
        const wanted = missing(build(true), vGroup.kids);
        if (wanted.length > 0) edits.push(insertionBeforeClose(src, vGroup, wanted));
      }
    } else if (build(false).length > 0) {
      const nodes: PerceptorNode[] = [{ name: 'PERCEPTOR', children: build(true) }];
      if (vTag) edits.push(insertionBeforeClose(src, vTag.tag, nodes));
      else newTags.push(tagBlock(`<Targets><TrackUID>${videoUid}</TrackUID></Targets>`, nodes));
    }
  }

  const known = new Set(input.tracks.map((t) => t.uid));
  for (const p of parsed) {
    const uid = p.uids.find((u) => known.has(u));
    if (uid === undefined) continue;
    const trackFlats = p.list.filter((s) => s.tagName === 'PERCEPTOR_SOURCE' || s.tagName === 'PERCEPTOR_OFFSET');
    const trackGroup = p.list.find((s) => s.tagName === 'PERCEPTOR');
    if (trackGroup) {
      for (const flat of trackFlats) edits.push(removal(src, flat));
      const sourceKid = trackGroup.kids.find((k) => k.tagName === 'SOURCE' && k.raw !== null);
      const provider = flatValue(trackGroup.kids, 'PROVIDER');
      if (sourceKid && provider !== null) {
        const prefix = `${provider.trim().toLowerCase()}:`;
        if (prefix.length > 1 && (sourceKid.raw as string).toLowerCase().startsWith(prefix)) {
          edits.push({ start: sourceKid.strStart, end: sourceKid.strStart + prefix.length, text: '' });
        }
      }
      continue;
    }
    if (trackFlats.length === 0) continue;
    const flatSource = flatValue(p.list, 'PERCEPTOR_SOURCE');
    const rawSource = flatValue(p.list, 'PERCEPTOR_SOURCE', true);
    const rawOffset = flatValue(p.list, 'PERCEPTOR_OFFSET', true);
    const api = input.facts.tracks.find(
      (t) => flatSource !== null && stripProvider(t.source, t.provider) === stripProvider(flatSource, t.provider),
    );
    const extra = buildTrackGroup({
      trackUid: uid,
      provider: api?.provider,
      syncScore: api?.syncScore,
      framerateRatio: api?.framerateRatio,
      embeddedAt: api?.embeddedAt,
    })[0]?.children ?? [];
    const kids: PerceptorNode[] = [
      ...(rawSource !== null ? [{ name: 'SOURCE', value: rawSource }] : []),
      ...(rawOffset !== null ? [{ name: 'OFFSET', value: rawOffset }] : []),
      ...extra.filter((c) => c.name !== 'SOURCE' && c.name !== 'OFFSET'),
    ];
    const [first, ...rest] = trackFlats;
    edits.push(replacement(src, first, [{ name: 'PERCEPTOR', children: kids }]));
    for (const flat of rest) edits.push(removal(src, flat));
  }

  if (newTags.length > 0) {
    if (root && root.innerEnd > root.innerStart) {
      const at = root.innerEnd - lineIndent(src, root.innerEnd).length;
      edits.push({ start: at, end: at, text: newTags.join('') });
    } else if (edits.length === 0) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<Tags>\n${newTags.join('')}</Tags>\n`;
    }
  }

  if (edits.length === 0) return 'unchanged';
  let out = src;
  for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}
