export const PUBLIC_PAGES = new Set(['overview', 'companions', 'guarantees']);

export function resolveRoute(mode = 'public', page = 'overview') {
  mode = String(mode || '').toLowerCase();
  page = String(page || 'overview');
  if (mode === 'public') return { mode: 'public', page: PUBLIC_PAGES.has(page) ? page : 'overview' };
  if (mode === 'management') return { mode, page: page || 'overview' };
  if (mode === 'personal') return page === 'overview' ? { mode: 'public', page: 'overview' } : { mode, page: page || 'overview' };
  return { mode: 'public', page: 'overview' };
}

export function parseRoute(hash = '', pathname = '/') {
  const raw = String(hash || '').trim();
  // /user is a direct entry point, while an explicit hash always takes precedence.
  if (!raw && /^\/user\/?$/.test(pathname)) return { mode: 'personal', page: 'memberProfile' };
  const legacy = { '#games': { mode: 'public', page: 'overview' }, '#members': { mode: 'public', page: 'companions' }, '#rules': { mode: 'public', page: 'guarantees' }, '#help': { mode: 'public', page: 'guarantees' } };
  if (legacy[raw]) return legacy[raw];
  const value = raw.replace(/^#\/?/, '');
  if (!value) return { mode: 'public', page: 'overview' };
  const [mode, page] = value.split('/');
  if (mode === 'public') return resolveRoute('public', page || 'overview');
  return resolveRoute(mode, page || 'overview');
}
