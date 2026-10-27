/** The server sends every time as Unix seconds (API.md); this is the one place they become a Date. */
export function fromEpochSeconds(n: number): Date {
  return new Date(n * 1000);
}
