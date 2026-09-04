import { useState } from 'react';
import { api, type AskResponse, type RecallResponse } from '../api.ts';

type Mode = 'sql' | 'recall';

const EXAMPLES: Record<Mode, string[]> = {
  sql: [
    'which entries have the highest share of very-low-confidence residues?',
    'show the ten longest proteins with their mean pLDDT',
    'which candidate disordered regions are longer than 100 residues?',
    'how many entries are modelled with a mean pLDDT above 90?',
  ],
  recall: [
    'which entries have long disordered tails?',
    'what does the annotation say about p53?',
    'which proteins are modelled with very high confidence throughout?',
  ],
};

export function Ask({ onOpen }: { onOpen: (accession: string) => void }) {
  const [mode, setMode] = useState<Mode>('sql');
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; sql?: string; reason?: string } | null>(
    null,
  );
  const [ask, setAsk] = useState<AskResponse | null>(null);
  const [recall, setRecall] = useState<RecallResponse | null>(null);

  async function submit(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3 || pending) return;
    setPending(true);
    setError(null);
    setAsk(null);
    setRecall(null);
    try {
      if (mode === 'sql') setAsk(await api.ask(trimmed));
      else setRecall(await api.recall(trimmed));
    } catch (cause) {
      const body = (cause as { body?: Record<string, unknown> }).body ?? {};
      setError({
        message: String((cause as Error).message),
        sql: typeof body.sql === 'string' ? body.sql : undefined,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <div className="mode-toggle">
            <button className={mode === 'sql' ? 'active' : ''} onClick={() => setMode('sql')}>
              Ask (SQL)
            </button>
            <button className={mode === 'recall' ? 'active' : ''} onClick={() => setMode('recall')}>
              Recall (RAG)
            </button>
          </div>
          <span className="muted">
            {mode === 'sql'
              ? 'The question is turned into a DuckDB query. The query is always shown.'
              : 'Answered from the annotation cards and structure summaries, with citations.'}
          </span>
        </div>

        <form
          className="ask-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(question);
          }}
        >
          <input
            placeholder={
              mode === 'sql'
                ? 'e.g. which entries have the most very-low-confidence residues?'
                : 'e.g. which entries have long disordered tails?'
            }
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button className="primary" type="submit" disabled={pending}>
            {pending ? 'Thinking…' : 'Ask'}
          </button>
        </form>

        <div className="examples">
          {EXAMPLES[mode].map((example) => (
            <button
              key={example}
              onClick={() => {
                setQuestion(example);
                void submit(example);
              }}
            >
              {example}
            </button>
          ))}
        </div>

        {pending && (
          <p className="muted" style={{ marginTop: 10 }}>
            A local model is generating this — expect a minute or so on CPU.
          </p>
        )}
      </div>

      {error && (
        <div className="panel">
          <h2>Rejected</h2>
          <p className="error">{error.message}</p>
          {error.reason && (
            <p className="muted">
              The SQL guard refused this query: <span className="mono">{error.reason}</span>. It
              never reached the database.
            </p>
          )}
          {error.sql && <pre className="sql">{error.sql}</pre>}
        </div>
      )}

      {ask && (
        <>
          <div className="panel">
            <h2>Generated SQL</h2>
            <pre className="sql">{ask.sql}</pre>
            <p className="muted" style={{ marginTop: 8 }}>
              {ask.relations.length > 0 ? `Reads ${ask.relations.join(', ')}. ` : ''}
              {ask.limitApplied ? 'A row cap was added. ' : ''}
              {ask.rowCount} row{ask.rowCount === 1 ? '' : 's'} returned.
            </p>
          </div>

          {ask.summary && (
            <div className="panel">
              <h2>Summary</h2>
              <p style={{ margin: 0 }}>{ask.summary}</p>
            </div>
          )}

          <div className="panel">
            <h2>Rows</h2>
            <ResultTable rows={ask.rows} onOpen={onOpen} />
          </div>
        </>
      )}

      {recall && (
        <>
          <div className="panel">
            <h2>Answer</h2>
            <p style={{ margin: 0 }}>{recall.answer}</p>
            {recall.citations.length > 0 && (
              <p className="muted" style={{ marginTop: 10 }}>
                Cited:{' '}
                {recall.citations.map((accession, index) => (
                  <span key={accession}>
                    {index > 0 && ', '}
                    <a
                      href={`#/protein/${accession}`}
                      onClick={(event) => {
                        event.preventDefault();
                        onOpen(accession);
                      }}
                    >
                      {accession}
                    </a>
                  </span>
                ))}
              </p>
            )}
            {!recall.grounded && (
              <p className="muted" style={{ marginTop: 10 }}>
                No passage was close enough to the question, so the model was not asked.
              </p>
            )}
          </div>

          {recall.passages.length > 0 && (
            <div className="panel">
              <h2>Retrieved passages</h2>
              {recall.passages.map((passage, index) => (
                <div className="passage" key={`${passage.accession}-${passage.source}-${index}`}>
                  <div className="meta">
                    <a
                      href={`#/protein/${passage.accession}`}
                      onClick={(event) => {
                        event.preventDefault();
                        onOpen(passage.accession);
                      }}
                    >
                      {passage.accession}
                    </a>{' '}
                    · {passage.source} · similarity {passage.similarity.toFixed(3)}
                  </div>
                  <div>{passage.text}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function ResultTable({
  rows,
  onOpen,
}: {
  rows: Record<string, unknown>[];
  onOpen: (accession: string) => void;
}) {
  if (rows.length === 0) return <p className="muted">Nothing matched.</p>;
  const columns = Object.keys(rows[0] ?? {});

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} style={{ cursor: 'default' }}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => {
                const value = row[column];
                const isAccession = column === 'accession' && typeof value === 'string';
                return (
                  <td key={column} className={isAccession ? 'mono' : undefined}>
                    {isAccession ? (
                      <a
                        href={`#/protein/${value as string}`}
                        onClick={(event) => {
                          event.preventDefault();
                          onOpen(value as string);
                        }}
                      >
                        {value as string}
                      </a>
                    ) : value === null || value === undefined ? (
                      '—'
                    ) : (
                      String(value)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
