const MAX_TAG_VALUE_CHARS = 500;

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

// Spec 107, REQ-14
export function sanitizeTagValue(value: string): string {
  const isControl = (char: string) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
  };
  return [...value]
    .filter((char) => !isControl(char))
    .join('')
    .trim()
    .slice(0, MAX_TAG_VALUE_CHARS)
    .replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}



// Spec 123, REQ-1
export type PerceptorNode = {
  name: string;
  value?: string;
  children?: PerceptorNode[];
};

export type GlobalTagFacts = {
  source?: string | null;
  version?: string | null;
  encodedAt?: Date | null;
};

// Spec 123, REQ-5
export type VideoTagFacts = {
  videoCodec?: 'av1' | 'copy' | null;
  crf?: number | null;
  preset?: number | null;
  contentKind?: string | null;
  resolutionCeiling?: string | null;
  sourceResolution?: string | null;
  outputResolution?: string | null;
  deinterlaced?: boolean | null;
  grainApplied?: boolean | null;
  grainDecidedBy?: 'title' | 'gate' | 'probe' | 'short' | null;
  dubTrimSeconds?: number | null;
  streamEndTrimSeconds?: number | null;
};

export type TrackTagFacts = {
  trackUid: number | string;
  source?: string | null;
  offsetMs?: number | null;
  provider?: string | null;
  syncScore?: number | null;
  framerateRatio?: number | null;
  embeddedAt?: Date | null;
};

function trackUidText(uid: number | string): string {
  return typeof uid === 'string' ? uid.replace(/\D/g, '') : String(Math.trunc(uid));
}

// Spec 123, REQ-2
function leaf(name: string, value: string | null | undefined): PerceptorNode[] {
  if (value === null || value === undefined) return [];
  const clean = sanitizeTagValue(value);
  return clean === '' ? [] : [{ name, value: clean }];
}

// Spec 123, REQ-3
function decimal(name: string, value: number | null | undefined): PerceptorNode[] {
  if (value === null || value === undefined || !Number.isFinite(value)) return [];
  return leaf(name, String(value));
}

// Spec 123, REQ-3
function timestamp(name: string, value: Date | null | undefined): PerceptorNode[] {
  if (!value || Number.isNaN(value.getTime())) return [];
  return leaf(name, `${value.toISOString().slice(0, 19)}Z`);
}

// Spec 123, REQ-6
function yesNo(name: string, value: boolean | null | undefined): PerceptorNode[] {
  if (value === null || value === undefined) return [];
  return leaf(name, value ? 'yes' : 'no');
}

// Spec 123, REQ-4
function trimSeconds(name: string, value: number | null | undefined): PerceptorNode[] {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return [];
  return leaf(name, value.toFixed(3));
}

// Spec 123, REQ-2
function group(name: string, children: PerceptorNode[]): PerceptorNode[] {
  return children.length === 0 ? [] : [{ name, children }];
}

// Spec 123, REQ-4
export function buildGlobalGroup(facts: GlobalTagFacts): PerceptorNode[] {
  return group('PERCEPTOR', [
    ...leaf('SOURCE', facts.source),
    ...leaf('VERSION', facts.version),
    ...timestamp('ENCODED_AT', facts.encodedAt),
  ]);
}

// Spec 123, REQ-5 REQ-6
export function buildVideoGroup(facts: VideoTagFacts): PerceptorNode[] {
  const copied = facts.videoCodec === 'copy';
  return group('PERCEPTOR', [
    ...(copied ? [] : decimal('CRF', facts.crf)),
    ...(copied ? [] : decimal('PRESET', facts.preset)),
    ...leaf('CONTENT_KIND', facts.contentKind),
    ...leaf('RESOLUTION_CEILING', facts.resolutionCeiling),
    ...leaf('SOURCE_RESOLUTION', facts.sourceResolution),
    ...(facts.deinterlaced === true ? leaf('DEINTERLACED', 'yes') : []),
    ...(copied ? [] : yesNo('GRAIN_APPLIED', facts.grainApplied)),
    ...(copied ? [] : leaf('GRAIN_DECIDED_BY', facts.grainDecidedBy)),
    ...trimSeconds('DUB_TRIM', facts.dubTrimSeconds),
    ...trimSeconds('STREAM_END_TRIM', facts.streamEndTrimSeconds),
  ]);
}

// Spec 123, REQ-9
export function buildTrackGroup(facts: TrackTagFacts): PerceptorNode[] {
  return group('PERCEPTOR', [
    ...leaf('SOURCE', facts.source),
    ...(facts.offsetMs === null || facts.offsetMs === undefined || !Number.isFinite(facts.offsetMs)
      ? []
      : decimal('OFFSET', Math.round(facts.offsetMs))),
    ...leaf('PROVIDER', facts.provider),
    ...decimal('SYNC_SCORE', facts.syncScore),
    ...decimal('FRAMERATE_RATIO', facts.framerateRatio),
    ...timestamp('EMBEDDED_AT', facts.embeddedAt),
  ]);
}

function renderNode(node: PerceptorNode, indent: string): string[] {
  const lines = [`${indent}<Simple>`, `${indent}  <Name>${node.name}</Name>`];
  if (node.value !== undefined) lines.push(`${indent}  <String>${node.value}</String>`);
  for (const child of node.children ?? []) lines.push(...renderNode(child, `${indent}  `));
  lines.push(`${indent}</Simple>`);
  return lines;
}

// Spec 123, REQ-9
export function renderTag(targets: string, nodes: PerceptorNode[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Tags>',
    '  <Tag>',
    `    ${targets}`,
    ...nodes.flatMap((node) => renderNode(node, '    ')),
    '  </Tag>',
    '</Tags>',
    '',
  ].join('\n');
}

// Spec 123, REQ-4
export function buildGlobalTagsXml(facts: GlobalTagFacts): string | null {
  const nodes = buildGlobalGroup(facts);
  return nodes.length === 0 ? null : renderTag('<Targets/>', nodes);
}

// Spec 123, REQ-9
export function buildTrackGroupXml(facts: TrackTagFacts): string | null {
  const nodes = buildTrackGroup(facts);
  if (nodes.length === 0) return null;
  return renderTag(`<Targets><TrackUID>${trackUidText(facts.trackUid)}</TrackUID></Targets>`, nodes);
}

// Spec 123, REQ-5
export function buildVideoTagsXml(facts: VideoTagFacts): string | null {
  const nodes = buildVideoGroup(facts);
  return nodes.length === 0 ? null : renderTag('<Targets/>', nodes);
}

// Spec 123, REQ-14
export function buildVideoTrackTagsXml(facts: VideoTagFacts, trackUid: number | string): string | null {
  const nodes = buildVideoGroup(facts);
  if (nodes.length === 0) return null;
  return renderTag(`<Targets><TrackUID>${trackUidText(trackUid)}</TrackUID></Targets>`, nodes);
}
