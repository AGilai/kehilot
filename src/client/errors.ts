export class ApiCodeError extends Error {
  status: number;
  code: string;
  /** Path of the offending field (`sections[0].rows[2].time.at`) when the server names one (400 with `field`); never user data. */
  field?: string;
  constructor(status: number, code: string, field?: string) {
    super(code);
    this.name = 'ApiCodeError';
    this.status = status;
    this.code = code;
    if (field !== undefined) this.field = field;
  }
}

/**
 * i18n key for an error code; unknown codes fall back to `errors.generic`.
 * `errors` is the `errors` object of the translation dictionary (the I18n layer passes it in).
 */
export function errorKey(code: string, errors: Record<string, string>): string {
  return Object.prototype.hasOwnProperty.call(errors, code) ? `errors.${code}` : 'errors.generic';
}
