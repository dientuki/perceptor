// Spec 113, REQ-4
export function decodeSidecar(buf: Buffer): string {
  if (
    buf.length >= 3 &&
    buf[0] === 0xef &&
    buf[1] === 0xbb &&
    buf[2] === 0xbf
  ) {
    return buf.subarray(3).toString('utf8');
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const body = Buffer.from(buf.subarray(2));
    const even = body.length - (body.length % 2);
    body.subarray(0, even).swap16();
    return body.subarray(0, even).toString('utf16le');
  }
  return buf.toString('utf8');
}
