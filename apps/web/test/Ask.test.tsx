// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ask } from '../src/views/Ask.tsx';
import { ApiError, api } from '../src/api.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Ask — SQL mode', () => {
  it('shows the generated SQL, summary and rows on success', async () => {
    vi.spyOn(api, 'ask').mockResolvedValue({
      question: 'q',
      sql: 'SELECT accession FROM proteins LIMIT 1',
      executedSql: 'SELECT accession FROM proteins LIMIT 1',
      relations: ['proteins'],
      limitApplied: false,
      rowCount: 1,
      rows: [{ accession: 'P12345' }],
      summary: 'One entry matched.',
    });

    render(<Ask onOpen={vi.fn()} />);
    await userEvent.type(
      screen.getByPlaceholderText(/most very-low-confidence/),
      'how many entries?',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText(/SELECT accession FROM proteins/)).toBeInTheDocument();
    expect(screen.getByText('One entry matched.')).toBeInTheDocument();
    expect(screen.getByText('P12345')).toBeInTheDocument();
  });

  it('shows the SQL guard rejection reason without calling onOpen', async () => {
    vi.spyOn(api, 'ask').mockRejectedValue(
      new ApiError('rejected', 400, { sql: 'DROP TABLE proteins', reason: 'destructive statement' }),
    );

    render(<Ask onOpen={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText(/most very-low-confidence/), 'drop it');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText('rejected')).toBeInTheDocument();
    expect(screen.getByText(/destructive statement/)).toBeInTheDocument();
    expect(screen.getByText(/DROP TABLE proteins/)).toBeInTheDocument();
  });
});

describe('Ask — Recall mode', () => {
  it('shows the grounded answer, citations and retrieved passages', async () => {
    vi.spyOn(api, 'recall').mockResolvedValue({
      question: 'q',
      answer: 'p53 has long disordered tails.',
      citations: ['P04637'],
      passages: [
        { accession: 'P04637', source: 'annotation', similarity: 0.812, text: 'summary text' },
      ],
      grounded: true,
    });

    render(<Ask onOpen={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Recall (RAG)' }));
    await userEvent.type(
      screen.getByPlaceholderText(/long disordered tails/),
      'which entries have long disordered tails?',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText('p53 has long disordered tails.')).toBeInTheDocument();
    // The accession is linked twice: once in the citation line, once on the passage itself.
    expect(screen.getAllByRole('link', { name: 'P04637' })).toHaveLength(2);
    expect(screen.getByText(/similarity 0.812/)).toBeInTheDocument();
  });

  it('explains when nothing was close enough to answer', async () => {
    vi.spyOn(api, 'recall').mockResolvedValue({
      question: 'q',
      answer: 'Nothing in the ingested AlphaFold entries is close enough to this question to answer it.',
      citations: [],
      passages: [],
      grounded: false,
    });

    render(<Ask onOpen={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Recall (RAG)' }));
    await userEvent.type(screen.getByPlaceholderText(/long disordered tails/), 'anything at all');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText(/model was not asked/)).toBeInTheDocument();
  });
});
