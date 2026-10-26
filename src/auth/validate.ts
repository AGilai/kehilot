export const normEmail = (s: string): string => s.trim().toLowerCase();
export const PASSWORD_MIN = 12;
export const NAME_MAX = 60;
/** Cognito policy: at least 12 characters, counted as code points. */
export const passwordOk = (p: string): boolean => [...p].length >= PASSWORD_MIN;
export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
