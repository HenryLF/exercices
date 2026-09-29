/**
 * A student's login is the only thing the app knows about them: initial of the last name, a dot,
 * then the first name (m.alice), lowercase letters and digits, computed in the admin's browser at
 * import (public/import-csv.js) so the name never reaches the server. At most one dot, 40 chars.
 */
export const LOGIN_RE = /^(?=.{1,40}$)[a-z0-9]+(\.[a-z0-9]+)?$/;

/** `base` if free, else `base2`, `base3`... (m.alice, m.alice2: logins are unique). */
export function freeLogin(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}
