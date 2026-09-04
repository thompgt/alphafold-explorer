export type Route = { name: 'browse' } | { name: 'ask' } | { name: 'protein'; accession: string };

/** Hash routing: three views do not justify a router dependency. */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'ask') return { name: 'ask' };
  const match = /^protein\/([A-Za-z0-9]+)$/.exec(path);
  if (match) return { name: 'protein', accession: match[1]!.toUpperCase() };
  return { name: 'browse' };
}
