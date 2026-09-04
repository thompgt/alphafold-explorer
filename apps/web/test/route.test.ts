import { describe, expect, it } from 'vitest';
import { parseHash } from '../src/route.ts';

describe('parseHash', () => {
  it('treats an empty or root hash as browse', () => {
    expect(parseHash('')).toEqual({ name: 'browse' });
    expect(parseHash('#/')).toEqual({ name: 'browse' });
    expect(parseHash('#')).toEqual({ name: 'browse' });
  });

  it('recognises the ask route', () => {
    expect(parseHash('#/ask')).toEqual({ name: 'ask' });
  });

  it('recognises a protein route and upper-cases the accession', () => {
    expect(parseHash('#/protein/p12345')).toEqual({ name: 'protein', accession: 'P12345' });
    expect(parseHash('#/protein/Q9Y6K9')).toEqual({ name: 'protein', accession: 'Q9Y6K9' });
  });

  it('falls back to browse for anything unrecognised', () => {
    expect(parseHash('#/nonsense')).toEqual({ name: 'browse' });
    expect(parseHash('#/protein/')).toEqual({ name: 'browse' });
    expect(parseHash('#/protein/has spaces')).toEqual({ name: 'browse' });
  });
});
