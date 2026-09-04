import { useEffect, useMemo, useState } from 'react';
import { api, type ProteinRow } from '../api.ts';
import { BandLegend, ConfidenceBar } from '../components/ConfidenceBar.tsx';

type SortKey = 'accession' | 'gene' | 'mean_plddt' | 'sequence_length' | 'pct_very_low';

const COLUMNS: { key: SortKey | 'bands' | 'name'; label: string; sortable: boolean }[] = [
  { key: 'accession', label: 'Accession', sortable: true },
  { key: 'gene', label: 'Gene', sortable: true },
  { key: 'name', label: 'Protein', sortable: false },
  { key: 'sequence_length', label: 'Length', sortable: true },
  { key: 'mean_plddt', label: 'Mean pLDDT', sortable: true },
  { key: 'pct_very_low', label: '% very low', sortable: true },
  { key: 'bands', label: 'Confidence bands', sortable: false },
];

export function Browse({ onOpen }: { onOpen: (accession: string) => void }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('mean_plddt');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [rows, setRows] = useState<ProteinRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Debounced so typing in the search box does not fire a request per keystroke.
    const timer = setTimeout(() => {
      api
        .listProteins({ q: query || undefined, sort, order })
        .then((result) => {
          if (cancelled) return;
          setRows(result.proteins);
          setTotal(result.total);
          setError(null);
        })
        .catch((cause: unknown) => !cancelled && setError(String(cause)))
        .finally(() => !cancelled && setLoading(false));
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, sort, order]);

  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    const withSummary = rows.filter((r) => r.mean_plddt !== null);
    if (withSummary.length === 0) return null;
    const mean =
      withSummary.reduce((sum, r) => sum + (r.mean_plddt ?? 0), 0) / withSummary.length;
    const disordered = withSummary.filter((r) => (r.pct_very_low ?? 0) > 20).length;
    return { mean, disordered, count: withSummary.length };
  }, [rows]);

  function toggleSort(key: SortKey) {
    if (key === sort) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setOrder(key === 'accession' || key === 'gene' ? 'asc' : 'desc');
    }
  }

  return (
    <>
      <div className="panel">
        <h2>Ingested AlphaFold entries</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            style={{ minWidth: 280 }}
            placeholder="Search accession, gene or protein name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="muted">
            {loading ? 'loading…' : `${rows.length} shown of ${total}`}
          </span>
          {summary && (
            <span className="muted">
              · mean pLDDT {summary.mean.toFixed(1)} · {summary.disordered} entries with over 20%
              very-low-confidence residues
            </span>
          )}
          <div style={{ flex: 1 }} />
          <BandLegend />
        </div>
      </div>

      {error && <div className="panel error">{error}</div>}

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    onClick={() => column.sortable && toggleSort(column.key as SortKey)}
                    style={{ cursor: column.sortable ? 'pointer' : 'default' }}
                  >
                    {column.label}
                    {column.sortable && sort === column.key ? (order === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.accession} style={{ cursor: 'pointer' }} onClick={() => onOpen(row.accession)}>
                  <td className="mono">
                    <a href={`#/protein/${row.accession}`} onClick={(e) => e.preventDefault()}>
                      {row.accession}
                    </a>
                  </td>
                  <td>{row.gene ?? '—'}</td>
                  <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.protein_name ?? '—'}
                  </td>
                  <td>{row.sequence_length}</td>
                  <td>{row.mean_plddt?.toFixed(1) ?? '—'}</td>
                  <td>{row.pct_very_low?.toFixed(1) ?? '—'}</td>
                  <td>
                    <ConfidenceBar protein={row} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="muted">
                    Nothing matched. Has `npm run ingest` been run?
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
