/**
 * Minimal mmCIF reader for exactly what we need out of an AlphaFold model:
 * the per-residue pLDDT, which AlphaFold stores in the B-factor column
 * (`_atom_site.B_iso_or_equiv`) of every atom of that residue.
 *
 * This is not a general CIF parser and does not try to be one — AlphaFold's
 * `_atom_site` loop is flat, single-chain and unquoted.
 */

export interface ParsedResidue {
  residueIndex: number;
  aminoAcid: string;
  plddt: number;
}

export interface ParsedStructure {
  residues: ParsedResidue[];
}

const THREE_TO_ONE: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
  GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
  SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  SEC: 'U', PYL: 'O', MSE: 'M',
};

export function threeToOne(code: string): string {
  return THREE_TO_ONE[code.toUpperCase()] ?? 'X';
}

/** Splits a CIF data row, honouring single/double quoted tokens. */
function tokenise(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = line.indexOf(ch, i + 1);
      if (end === -1) {
        tokens.push(line.slice(i + 1));
        break;
      }
      tokens.push(line.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    let end = i;
    while (end < line.length && line[end] !== ' ' && line[end] !== '\t') end += 1;
    tokens.push(line.slice(i, end));
    i = end;
  }
  return tokens;
}

/**
 * Reads per-residue pLDDT from an AlphaFold mmCIF.
 *
 * Residue identity comes from the CA atom where present (every standard residue has
 * one); glycine and any residue missing a CA fall back to the first atom seen, and the
 * pLDDT is averaged across that residue's atoms. AlphaFold writes an identical value on
 * every atom of a residue, so the average is exact in practice and robust if that ever
 * changes.
 */
export function parseCifPlddt(cif: string): ParsedStructure {
  const lines = cif.split('\n');
  const columns: string[] = [];
  let inHeader = false;
  let inData = false;

  // residueIndex -> accumulator
  const acc = new Map<number, { aa: string; sum: number; count: number; ca?: number }>();

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();

    if (!inData) {
      if (trimmed.startsWith('_atom_site.')) {
        inHeader = true;
        columns.push(trimmed.split(/\s+/)[0]!.slice('_atom_site.'.length));
        continue;
      }
      if (inHeader && trimmed !== '' && !trimmed.startsWith('_')) {
        inData = true;
        // fall through and parse this line as data
      } else {
        continue;
      }
    }

    if (trimmed === '' || trimmed === '#' || trimmed.startsWith('loop_') || trimmed.startsWith('_')) {
      break;
    }
    if (trimmed.startsWith('ATOM') || trimmed.startsWith('HETATM')) {
      const tokens = tokenise(trimmed);
      if (tokens.length < columns.length) continue;
      const get = (name: string): string | undefined => {
        const idx = columns.indexOf(name);
        return idx === -1 ? undefined : tokens[idx];
      };

      const seqRaw = get('label_seq_id') ?? get('auth_seq_id');
      const bRaw = get('B_iso_or_equiv');
      const compRaw = get('label_comp_id') ?? get('auth_comp_id');
      const atomName = get('label_atom_id') ?? get('auth_atom_id');
      if (seqRaw === undefined || bRaw === undefined || compRaw === undefined) continue;

      const residueIndex = Number.parseInt(seqRaw, 10);
      const plddt = Number.parseFloat(bRaw);
      if (!Number.isFinite(residueIndex) || !Number.isFinite(plddt)) continue;

      let entry = acc.get(residueIndex);
      if (!entry) {
        entry = { aa: threeToOne(compRaw), sum: 0, count: 0 };
        acc.set(residueIndex, entry);
      }
      entry.sum += plddt;
      entry.count += 1;
      if (atomName === 'CA') entry.ca = plddt;
    }
  }

  const residues: ParsedResidue[] = [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([residueIndex, e]) => ({
      residueIndex,
      aminoAcid: e.aa,
      plddt: round2(e.ca ?? e.sum / e.count),
    }));

  return { residues };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
