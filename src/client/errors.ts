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

/**
 * i18n key for an error code; unknown codes fall back to `errors.generic`.
 * `errors` is the `errors` object of the translation dictionary (the I18n layer passes it in).
 */
export function errorKey(code: string, errors: Record<string, string>): string {
  return Object.prototype.hasOwnProperty.call(errors, code) ? `errors.${code}` : 'errors.generic';
}
