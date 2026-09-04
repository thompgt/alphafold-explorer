import { describe, expect, it } from 'vitest';
import { findLowConfidenceSegments, summariseConfidence } from '../src/features.ts';
import type { ParsedResidue } from '../src/cifPlddt.ts';

function residues(plddts: number[]): ParsedResidue[] {
  return plddts.map((plddt, i) => ({ residueIndex: i + 1, aminoAcid: 'A', plddt }));
}

describe('summariseConfidence', () => {
  it('bins residues into AlphaFold confidence bands', () => {
    // 2 very high (>=90), 2 confident (70-90), 2 low (50-70), 4 very low (<50)
    const s = summariseConfidence('TEST', residues([95, 90, 89, 70, 69, 50, 49, 30, 20, 10]));
    expect(s.pct_very_high).toBe(20);
    expect(s.pct_confident).toBe(20);
    expect(s.pct_low).toBe(20);
    expect(s.pct_very_low).toBe(40);
    expect(s.min_plddt).toBe(10);
    expect(s.max_plddt).toBe(95);
  });

  it('computes mean and median', () => {
    const s = summariseConfidence('TEST', residues([10, 20, 30, 40]));
    expect(s.mean_plddt).toBe(25);
    expect(s.median_plddt).toBe(25);
    expect(summariseConfidence('TEST', residues([10, 20, 30])).median_plddt).toBe(20);
  });

  it('measures the longest run below the confident band', () => {
    const s = summariseConfidence('TEST', residues([95, 40, 40, 40, 95, 40, 40]));
    expect(s.longest_low_run).toBe(3);
  });

  it('refuses to summarise an empty structure', () => {
    expect(() => summariseConfidence('TEST', [])).toThrow(/no residues/);
  });
});

describe('findLowConfidenceSegments', () => {
  it('finds runs at or above the minimum length and skips shorter ones', () => {
    // 10 low at the N-terminus, then a 3-residue dip that is too short to count.
    const plddts = [...Array(10).fill(30), ...Array(10).fill(95), 40, 40, 40, ...Array(10).fill(95)];
    const segments = findLowConfidenceSegments('TEST', residues(plddts));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      segment_id: 'TEST:1-10',
      start_residue: 1,
      end_residue: 10,
      length: 10,
      mean_plddt: 30,
      terminal: 'N',
    });
  });

  it('labels the terminus a segment sits at', () => {
    const cTerm = findLowConfidenceSegments(
      'TEST',
      residues([...Array(10).fill(95), ...Array(10).fill(30)]),
    );
    expect(cTerm[0]?.terminal).toBe('C');

    const internal = findLowConfidenceSegments(
      'TEST',
      residues([...Array(5).fill(95), ...Array(10).fill(30), ...Array(5).fill(95)]),
    );
    expect(internal[0]?.terminal).toBe('internal');

    const whole = findLowConfidenceSegments('TEST', residues(Array(20).fill(30)));
    expect(whole[0]?.terminal).toBe('both');
  });

  it('does not join runs across a gap in residue numbering', () => {
    const withGap: ParsedResidue[] = [
      ...residues(Array(10).fill(30)),
      // jump from residue 10 to residue 50
      ...Array.from({ length: 10 }, (_, i) => ({
        residueIndex: 50 + i,
        aminoAcid: 'A',
        plddt: 30,
      })),
    ];
    const segments = findLowConfidenceSegments('TEST', withGap);
    expect(segments.map((s) => s.segment_id)).toEqual(['TEST:1-10', 'TEST:50-59']);
  });

  it('returns nothing for a fully confident structure', () => {
    expect(findLowConfidenceSegments('TEST', residues(Array(50).fill(95)))).toEqual([]);
  });
});
