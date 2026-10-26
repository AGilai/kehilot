import he from '../i18n/he.json' with { type: 'json' };

export class ApiCodeError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = 'ApiCodeError';
    this.status = status;
    this.code = code;
  }
}

const known = he.errors as Record<string, string>;

/** i18n key for an error code; unknown codes fall back to `errors.generic`. */
export function errorKey(code: string): string {
  return Object.prototype.hasOwnProperty.call(known, code) ? `errors.${code}` : 'errors.generic';
}
