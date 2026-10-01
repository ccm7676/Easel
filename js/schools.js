/* Find-my-school lookup, so setup can offer a search box instead of asking
 * people to know their Canvas address.
 *
 * Uses the public school directory behind Canvas's own mobile apps. It is not
 * a documented API, so nothing here is trusted: setup probes it every time
 * before offering the search, and falls back to typing the address whenever it
 * misbehaves. It is open to any origin (CORS *) and needs no login, so it asks
 * for no extra browser permission; requests go out without cookies.
 */

import { normalizeOrigin } from './canvas.js';

const ENDPOINT = 'https://canvas.instructure.com/api/v1/accounts/search';

/** Past this a slow endpoint is as good as a broken one. */
const TIMEOUT_MS = 4000;

/** A query nearly every install of the directory answers with something. */
const PROBE_QUERY = 'university';

/**
 * @typedef {object} School
 * @property {string} name
 * @property {string} origin e.g. "https://canvas.stanford.edu"
 */

/**
 * Asks the directory for schools matching `query`.
 * @param {AbortSignal} [signal] lets a newer keystroke cancel this lookup
 * @returns {Promise<School[]>} at most one entry per Canvas address
 * @throws {Error} if the directory cannot be reached or answers with
 *   something that is not a school list
 */
export async function searchSchools(query, signal) {
  const url = `${ENDPOINT}?name=${encodeURIComponent(query)}`;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) throw new Error(`School search returned ${res.status}.`);

  const body = await res.json();
  if (!Array.isArray(body)) throw new Error('School search sent an unexpected reply.');

  const seen = new Set();
  const schools = [];
  for (const entry of body) {
    const school = toSchool(entry);
    if (!school || seen.has(school.origin)) continue;
    seen.add(school.origin);
    schools.push(school);
  }
  return schools;
}

/**
 * Whether the directory is up and still answers the way this file expects: a
 * real search that returns at least one usable school. A bare "200 OK" is not
 * enough, since a changed or stubbed endpoint can say that and be useless.
 * Never throws.
 * @returns {Promise<boolean>}
 */
export async function schoolSearchWorks() {
  try {
    return (await searchSchools(PROBE_QUERY)).length > 0;
  } catch {
    return false;
  }
}

/** One directory entry, or null if it is missing a name or a usable address. */
function toSchool(entry) {
  if (typeof entry?.name !== 'string' || typeof entry.domain !== 'string') return null;
  const name = entry.name.trim();
  if (!name) return null;
  try {
    return { name, origin: normalizeOrigin(entry.domain) };
  } catch {
    return null;
  }
}
