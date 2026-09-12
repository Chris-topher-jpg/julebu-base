export function resolveRoute(mode = 'public', page = 'overview') {
  if (mode === 'management' || (mode === 'personal' && page !== 'overview')) return { mode, page };
  return { mode: 'public', page: 'overview' };
}

export function parseRoute(hash) {
  const [mode, page] = hash.replace(/^#\/?/, '').split('/');
  return resolveRoute(mode, page || 'overview');
}
