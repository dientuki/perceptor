// Spec 100, REQ-2

export interface MplsPlayItem {
  clipName: string;
  inTicks: number;
  outTicks: number;
}

export interface ParsedMpls {
  items: MplsPlayItem[];
  entryMarkCount: number;
}

const HEADER_BYTES = 20;
const ENTRY_MARK_TYPE = 1;
const MARK_BYTES = 14;

function need(buffer: Buffer, offset: number, length: number, what: string): void {
  if (offset < 0 || offset + length > buffer.length) {
    throw new Error(`Truncated MPLS: cannot read ${what} at offset ${offset}`);
  }
}

export function parseMpls(buffer: Buffer): ParsedMpls {
  need(buffer, 0, HEADER_BYTES, 'the header');
  if (buffer.toString('ascii', 0, 4) !== 'MPLS') {
    throw new Error('Not an MPLS file: bad magic');
  }
  const playListStart = buffer.readUInt32BE(8);
  const markStart = buffer.readUInt32BE(12);

  need(buffer, playListStart, 10, 'the PlayList header');
  const itemCount = buffer.readUInt16BE(playListStart + 6);
  const items: MplsPlayItem[] = [];
  let cursor = playListStart + 10;
  for (let i = 0; i < itemCount; i++) {
    need(buffer, cursor, 2, 'a play item length');
    const length = buffer.readUInt16BE(cursor);
    need(buffer, cursor, 2 + 22, 'a play item');
    if (length < 22) throw new Error(`Malformed MPLS: play item ${i} is ${length} bytes long`);
    need(buffer, cursor, 2 + length, 'a play item');
    items.push({
      clipName: buffer.toString('ascii', cursor + 2, cursor + 7),
      inTicks: buffer.readUInt32BE(cursor + 14),
      outTicks: buffer.readUInt32BE(cursor + 18),
    });
    cursor += 2 + length;
  }

  need(buffer, markStart, 6, 'the PlayListMark header');
  const markCount = buffer.readUInt16BE(markStart + 4);
  let entryMarkCount = 0;
  for (let i = 0; i < markCount; i++) {
    const at = markStart + 6 + i * MARK_BYTES;
    need(buffer, at, MARK_BYTES, 'a playlist mark');
    if (buffer.readUInt8(at + 1) === ENTRY_MARK_TYPE) entryMarkCount++;
  }

  return { items, entryMarkCount };
}
