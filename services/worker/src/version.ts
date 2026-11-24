// Spec 123, NFR-5
export function perceptorVersion(): string {
  const value = process.env.PERCEPTOR_VERSION?.trim();
  return value ? value : 'dev';
}
