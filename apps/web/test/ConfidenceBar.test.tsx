// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BandLegend, ConfidenceBar } from '../src/components/ConfidenceBar.tsx';
import type { ProteinRow } from '../src/api.ts';

afterEach(cleanup);

const BASE: ProteinRow = {
  accession: 'P12345',
  entry_id: 'AF-P12345-F1',
  protein_name: 'Test protein',
  gene: 'TST1',
  organism: 'Homo sapiens',
  sequence_length: 200,
  mean_plddt: 88,
  pct_very_high: 40,
  pct_confident: 40,
  pct_low: 15,
  pct_very_low: 5,
  longest_low_run: 10,
  annotation_status: 'complete',
};

describe('BandLegend', () => {
  it('lists all four AlphaFold confidence bands', () => {
    render(<BandLegend />);
    expect(screen.getByText(/Very high/)).toBeInTheDocument();
    expect(screen.getByText(/Confident/)).toBeInTheDocument();
    expect(screen.getByText(/^Low/)).toBeInTheDocument();
    expect(screen.getByText(/Very low/)).toBeInTheDocument();
  });
});

describe('ConfidenceBar', () => {
  it('renders one segment per non-zero band, proportioned to their share', () => {
    render(<ConfidenceBar protein={BASE} />);
    const bar = screen.getByRole('img', { name: /confidence bands for P12345/ });
    const segments = bar.querySelectorAll('span');
    expect(segments).toHaveLength(4);
    expect(segments[0]).toHaveStyle({ width: '40%' });
    expect(segments[3]).toHaveStyle({ width: '5%' });
  });

  it('falls back to a plain label when nothing has been summarised', () => {
    const empty: ProteinRow = {
      ...BASE,
      mean_plddt: null,
      pct_very_high: null,
      pct_confident: null,
      pct_low: null,
      pct_very_low: null,
    };
    render(<ConfidenceBar protein={empty} />);
    expect(screen.getByText('not summarised')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
