// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Browse } from '../src/views/Browse.tsx';
import { api, type ProteinRow } from '../src/api.ts';

const ROW: ProteinRow = {
  accession: 'P12345',
  entry_id: 'AF-P12345-F1',
  protein_name: 'Test protein',
  gene: 'TST1',
  organism: 'Homo sapiens',
  sequence_length: 200,
  mean_plddt: 88.4,
  pct_very_high: 40,
  pct_confident: 40,
  pct_low: 15,
  pct_very_low: 5,
  longest_low_run: 10,
  annotation_status: 'complete',
};

describe('Browse', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listProteins').mockResolvedValue({ total: 1, proteins: [ROW] });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('lists proteins returned by the API', async () => {
    render(<Browse onOpen={vi.fn()} />);
    expect(await screen.findByText('P12345')).toBeInTheDocument();
    expect(screen.getByText('TST1')).toBeInTheDocument();
    expect(screen.getByText('88.4')).toBeInTheDocument();
    expect(screen.getByText('1 shown of 1')).toBeInTheDocument();
  });

  it('opens a protein when its row is clicked', async () => {
    const onOpen = vi.fn();
    render(<Browse onOpen={onOpen} />);
    const cell = await screen.findByText('P12345');
    await userEvent.click(cell.closest('tr')!);
    expect(onOpen).toHaveBeenCalledWith('P12345');
  });

  it('debounces the search box and re-queries with the typed text', async () => {
    render(<Browse onOpen={vi.fn()} />);
    await screen.findByText('P12345');
    vi.mocked(api.listProteins).mockClear();

    await userEvent.type(screen.getByPlaceholderText(/Search accession/), 'p53');

    await waitFor(() =>
      expect(api.listProteins).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'p53' }),
      ),
    );
  });

  it('shows an empty-state message and no rows when nothing matches', async () => {
    vi.mocked(api.listProteins).mockResolvedValue({ total: 0, proteins: [] });
    render(<Browse onOpen={vi.fn()} />);
    expect(await screen.findByText(/Nothing matched/)).toBeInTheDocument();
  });

  it('shows the API error instead of a table on failure', async () => {
    vi.mocked(api.listProteins).mockRejectedValue(new Error('offline'));
    render(<Browse onOpen={vi.fn()} />);
    expect(await screen.findByText(/offline/)).toBeInTheDocument();
  });
});
