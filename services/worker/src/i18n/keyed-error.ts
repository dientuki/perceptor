// Spec 018, REQ-11 T033

export class KeyedError extends Error {
  readonly key: string;
  readonly params?: Record<string, string | number>;

  constructor(key: string, message: string, params?: Record<string, string | number>) {
    super(message);
    this.name = 'KeyedError';
    this.key = key;
    this.params = params;
  }
}
