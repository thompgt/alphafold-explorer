// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProteinDetail, Residue } from '../src/api.ts';
import { api } from '../src/api.ts';
import { Protein } from '../src/views/Protein.tsx';

// StructureViewer boots a real Mol* WebGL plugin, which jsdom can't provide and
// which the other assertions here don't depend on — stub it out.
vi.mock('../src/components/StructureViewer.tsx', () => ({
  StructureViewer: () => <div data-testid="structure-viewer-stub" />,
}));

const RESIDUES: Residue[] = [
  { residue_index: 1, amino_acid: 'M', plddt: 91 },
  { residue_index: 2, amino_acid: 'A', plddt: 45 },
];

function detail(overrides: Partial<ProteinDetail> = {}): ProteinDetail {
  return {
    protein: {
      accession: 'P12345',
      entry_id: 'AF-P12345-F1',
      protein_name: 'Test protein',
      gene: 'TST1',
      organism: 'Homo sapiens',
      sequence_length: 2,
      mean_plddt: 68,
      pct_very_high: 50,
      pct_confident: 0,
      pct_low: 0,
      pct_very_low: 50,
      longest_low_run: 1,
      annotation_status: 'complete',
      sequence: 'MA',
      uniprot_description: null,
      model_version: 6,
      cif_url: 'https://example.test/P12345.cif',
      median_plddt: 68,
      min_plddt: 45,
      max_plddt: 91,
    },
    segments: [],
    annotation: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Protein', () => {
  it('shows a loading state, then the fetched protein and residue track', async () => {
    vi.spyOn(api, 'getProtein').mockResolvedValue(detail());
    vi.spyOn(api, 'getResidues').mockResolvedValue({ accession: 'P12345', residues: RESIDUES });

    render(<Protein accession="P12345" onBack={vi.fn()} />);
    expect(screen.getByText(/Loading P12345/)).toBeInTheDocument();

    expect(await screen.findByText('Test protein')).toBeInTheDocument();
    expect(screen.getByText('TST1')).toBeInTheDocument();
    expect(screen.getByTestId('structure-viewer-stub')).toBeInTheDocument();
  });

  it('shows the annotation card when present', async () => {
    vi.spyOn(api, 'getProtein').mockResolvedValue(
      detail({
        annotation: {
          status: 'complete',
          model: 'llama3.1:8b',
          generated_at: '2026-01-01T00:00:00Z',
          error: null,
          card: {
            summary: 'A well-modelled protein.',
            confidence_profile: 'Mostly high confidence.',
            disordered_regions: 'None of note.',
            caveats: 'None.',
            keywords: ['kinase', 'membrane'],
          },
        },
      }),
    );
    vi.spyOn(api, 'getResidues').mockResolvedValue({ accession: 'P12345', residues: RESIDUES });

    render(<Protein accession="P12345" onBack={vi.fn()} />);
    expect(await screen.findByText('A well-modelled protein.')).toBeInTheDocument();
    expect(screen.getByText('kinase')).toBeInTheDocument();
  });

  it('says no card exists yet when there is no annotation', async () => {
    vi.spyOn(api, 'getProtein').mockResolvedValue(detail());
    vi.spyOn(api, 'getResidues').mockResolvedValue({ accession: 'P12345', residues: RESIDUES });

    render(<Protein accession="P12345" onBack={vi.fn()} />);
    expect(await screen.findByText(/No card yet/)).toBeInTheDocument();
  });

  it('regenerates the annotation on demand', async () => {
    vi.spyOn(api, 'getProtein')
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(
        detail({
          annotation: {
            status: 'complete',
            model: 'llama3.1:8b',
            generated_at: '2026-01-01T00:00:00Z',
            error: null,
            card: {
              summary: 'Freshly regenerated.',
              confidence_profile: '—',
              disordered_regions: '—',
              caveats: '—',
              keywords: [],
            },
          },
        }),
      );
    vi.spyOn(api, 'getResidues').mockResolvedValue({ accession: 'P12345', residues: RESIDUES });
    vi.spyOn(api, 'reannotate').mockResolvedValue({
      accession: 'P12345',
      card: {
        summary: 'Freshly regenerated.',
        confidence_profile: '—',
        disordered_regions: '—',
        caveats: '—',
        keywords: [],
      },
    });

    render(<Protein accession="P12345" onBack={vi.fn()} />);
    await screen.findByText(/No card yet/);

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));

    expect(await screen.findByText('Freshly regenerated.')).toBeInTheDocument();
    expect(api.reannotate).toHaveBeenCalledWith('P12345');
  });

  it('shows an error instead of the panel when the fetch fails', async () => {
    vi.spyOn(api, 'getProtein').mockRejectedValue(new Error('not found'));
    vi.spyOn(api, 'getResidues').mockResolvedValue({ accession: 'P12345', residues: [] });

    render(<Protein accession="P12345" onBack={vi.fn()} />);
    expect(await screen.findByText(/not found/)).toBeInTheDocument();
  });
});
