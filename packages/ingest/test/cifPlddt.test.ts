import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCifPlddt, threeToOne } from '../src/cifPlddt.ts';

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/AF-P69905-F1-truncated.cif',
);
const cif = fs.readFileSync(FIXTURE, 'utf8');

describe('parseCifPlddt', () => {
  it('reads one residue per label_seq_id', () => {
    const { residues } = parseCifPlddt(cif);
    expect(residues).toHaveLength(20);
    expect(residues.map((r) => r.residueIndex)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('takes pLDDT from the CA atom and converts residue names', () => {
    const { residues } = parseCifPlddt(cif);
    // Values verified against the published AF-P69905-F1 v6 model.
    expect(residues[0]).toEqual({ residueIndex: 1, aminoAcid: 'M', plddt: 65.38 });
    expect(residues[1]).toEqual({ residueIndex: 2, aminoAcid: 'V', plddt: 91.12 });
    expect(residues[3]).toEqual({ residueIndex: 4, aminoAcid: 'S', plddt: 98.5 });
    expect(residues[19]).toEqual({ residueIndex: 20, aminoAcid: 'A', plddt: 96.38 });
  });

  it('reconstructs the N-terminal sequence', () => {
    const { residues } = parseCifPlddt(cif);
    expect(residues.map((r) => r.aminoAcid).join('')).toBe('MVLSPADKTNVKAAWGKVGA');
  });

  it('falls back to the atom average when no CA atom is present', () => {
    const noCa = cif
      .split('\n')
      .filter((line) => !/^ATOM\s+\d+\s+C\s+CA\s/.test(line))
      .join('\n');
    const { residues } = parseCifPlddt(noCa);
    expect(residues).toHaveLength(20);
    // AlphaFold writes the same pLDDT on every atom of a residue, so the mean matches.
    expect(residues[0]?.plddt).toBe(65.38);
  });

  it('returns nothing for input with no atom_site loop', () => {
    expect(parseCifPlddt('data_EMPTY\n#\n').residues).toEqual([]);
  });

  it('maps unknown residue codes to X', () => {
    expect(threeToOne('ALA')).toBe('A');
    expect(threeToOne('MSE')).toBe('M');
    expect(threeToOne('ZZZ')).toBe('X');
  });
});
