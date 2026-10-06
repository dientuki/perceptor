// One definition of the qBittorrent tag sanitiser, shared by every
// acquisition path instead of four byte-identical copies.

// Spec 088, REQ-11
export function sanitizeTag(title: string, fallbackId: number): string {
  const cleaned = title.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || `id-${fallbackId}`;
}
