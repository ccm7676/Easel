/* Canvas LMS REST client.
 *
 * Runs from the new tab page, which is an extension page — with the matching
 * host permission granted, these cross-origin requests are exempt from CORS,
 * so no service-worker proxy is needed.
 */

/** Distinguishable failure modes so the UI can say something useful. */
export class CanvasError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'CanvasError';
    this.kind = kind; // 'auth' | 'forbidden' | 'ratelimit' | 'network' | 'http'
  }
}

/**
 * Accepts anything a person might paste — "school.instructure.com",
 * "https://canvas.school.edu/courses/123" — and returns a bare origin.
 * @returns {string} e.g. "https://school.instructure.com"
 */
export function normalizeOrigin(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('Enter your Canvas web address.');
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('That does not look like a web address.');
  }
  if (!url.hostname.includes('.')) {
    throw new Error('That does not look like a web address.');
  }
  if (url.protocol !== 'https:') {
    throw new Error('Canvas must be reached over https.');
  }
  return url.origin;
}

/** The host permission pattern for an origin. */
export function originPattern(origin) {
  return `${origin}/*`;
}

function parseNextLink(header) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m) return m[1];
  }
  return null;
}

/**
 * One request. Returns { body, response }.
 */
async function request(url, token) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (cause) {
    throw new CanvasError('network', 'Could not reach Canvas.');
  }

  if (res.status === 401) {
    throw new CanvasError('auth', 'Canvas rejected the access token.');
  }
  if (res.status === 403) {
    const text = await res.text().catch(() => '');
    const kind = /rate limit/i.test(text) ? 'ratelimit' : 'forbidden';
    throw new CanvasError(
      kind,
      kind === 'ratelimit'
        ? 'Canvas is rate limiting this token. Try again shortly.'
        : 'This token is not allowed to read that.'
    );
  }
  if (!res.ok) {
    throw new CanvasError('http', `Canvas returned ${res.status}.`);
  }

  const body = await res.json().catch(() => {
    throw new CanvasError('http', 'Canvas sent a response we could not read.');
  });
  return { body, res };
}

/**
 * GET a paginated collection, following Link rel="next".
 * @param {number} maxPages guard so a bad cursor can never loop forever.
 */
async function getAll({ origin, token }, path, { maxPages = 10 } = {}) {
  let url = `${origin}/api/v1${path}`;
  const out = [];
  for (let page = 0; page < maxPages && url; page++) {
    const { body, res } = await request(url, token);
    if (!Array.isArray(body)) return body;
    out.push(...body);
    url = parseNextLink(res.headers.get('link'));
  }
  return out;
}

async function getOne({ origin, token }, path) {
  const { body } = await request(`${origin}/api/v1${path}`, token);
  return body;
}

/** Validates the token and returns the Canvas user. */
export function getSelf(settings) {
  return getOne(settings, '/users/self');
}

/** Active courses, with enough included to show a current grade. */
export async function getCourses(settings) {
  const list = await getAll(
    settings,
    '/courses?enrollment_state=active&enrollment_type=student' +
      '&include[]=total_scores&include[]=course_image&per_page=100'
  );
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && !c.access_restricted_by_date && c.id)
    .map((c) => {
      const enrollment = Array.isArray(c.enrollments) ? c.enrollments[0] : null;
      return {
        id: c.id,
        name: c.name ?? 'Untitled course',
        code: c.course_code ?? '',
        url: `${settings.origin}/courses/${c.id}`,
        score: enrollment?.computed_current_score ?? null,
        grade: enrollment?.computed_current_grade ?? null,
      };
    });
}

/**
 * Assignments for one bucket across every course.
 *
 * `bucket=future` — not `upcoming`. Canvas defines `upcoming` as due within the
 * next 7 days only (lib/sorts_assignments.rb), which would silently hide
 * anything further out. `future` is "due_at IS NULL OR due_at >= now".
 *
 * Uses allSettled so one unreadable course cannot blank the whole panel.
 *
 * @param {'future'|'past'} bucket
 * @returns {Promise<{items:Array, failed:number}>}
 */
export async function getAssignments(settings, courses, bucket) {
  const results = await Promise.allSettled(
    courses.map((course) =>
      getAll(
        settings,
        `/courses/${course.id}/assignments?bucket=${bucket}` +
          `&include[]=submission&order_by=due_at&per_page=50`,
        { maxPages: 4 }
      ).then((list) => ({ course, list: Array.isArray(list) ? list : [] }))
    )
  );

  let failed = 0;
  const items = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') {
      failed++;
      // An expired token should surface rather than read as "no assignments".
      if (r.reason instanceof CanvasError && r.reason.kind === 'auth') throw r.reason;
      continue;
    }
    const { course, list } = r.value;
    for (const a of list) {
      if (!a || !a.id) continue;
      items.push({
        id: `${course.id}-${a.id}`,
        title: a.name ?? 'Untitled assignment',
        courseName: course.name,
        courseCode: course.code,
        url: a.html_url ?? `${settings.origin}/courses/${course.id}/assignments/${a.id}`,
        dueAt: a.due_at ?? null,
        points: typeof a.points_possible === 'number' ? a.points_possible : null,
        submissionTypes: Array.isArray(a.submission_types) ? a.submission_types : [],
        submissionState: a.submission?.workflow_state ?? null,
        submittedAt: a.submission?.submitted_at ?? null,
        score: typeof a.submission?.score === 'number' ? a.submission.score : null,
      });
    }
  }

  sortByDue(items, bucket === 'past' ? 'desc' : 'asc');
  return { items, failed };
}

/** Undated assignments always sink to the bottom, whichever direction we sort. */
function sortByDue(items, direction) {
  const sign = direction === 'desc' ? -1 : 1;
  items.sort((a, b) => {
    if (!a.dueAt && !b.dueAt) return a.title.localeCompare(b.title);
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return sign * (new Date(a.dueAt) - new Date(b.dueAt));
  });
}
