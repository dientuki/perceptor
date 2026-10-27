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

// Spec 107, REQ-14
export function buildTrackTagsXml(source: string, offsetMs: number): string {
  const offset = Number.isFinite(offsetMs) ? Math.round(offsetMs) : 0;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Tags>',
    '  <Tag>',
    '    <Targets/>',
    '    <Simple>',
    '      <Name>PERCEPTOR_SOURCE</Name>',
    `      <String>${sanitizeTagValue(source)}</String>`,
    '    </Simple>',
    '    <Simple>',
    '      <Name>PERCEPTOR_OFFSET</Name>',
    `      <String>${offset}</String>`,
    '    </Simple>',
    '  </Tag>',
    '</Tags>',
    '',
  ].join('\n');
}
