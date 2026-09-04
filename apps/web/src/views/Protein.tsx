import { useEffect, useState } from 'react';
import { api, type ProteinDetail, type Residue } from '../api.ts';
import { BandLegend } from '../components/ConfidenceBar.tsx';
import { ConfidenceTrack } from '../components/ConfidenceTrack.tsx';
import { StructureViewer } from '../components/StructureViewer.tsx';

export function Protein({ accession, onBack }: { accession: string; onBack: () => void }) {
  const [detail, setDetail] = useState<ProteinDetail | null>(null);
  const [residues, setResidues] = useState<Residue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setResidues([]);
    setError(null);

    Promise.all([api.getProtein(accession), api.getResidues(accession)])
      .then(([protein, residueData]) => {
        if (cancelled) return;
        setDetail(protein);
        setResidues(residueData.residues);
      })
      .catch((cause: unknown) => !cancelled && setError(String(cause)));

    return () => {
      cancelled = true;
    };
  }, [accession]);

  async function regenerate() {
    setRegenerating(true);
    try {
      await api.reannotate(accession);
      setDetail(await api.getProtein(accession));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setRegenerating(false);
    }
  }

  if (error) return <div className="panel error">{error}</div>;
  if (!detail) return <div className="panel muted">Loading {accession}…</div>;

  const { protein, segments, annotation } = detail;

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={onBack}>← All entries</button>
          <h2 style={{ margin: 0, textTransform: 'none', fontSize: 18, color: 'var(--text)' }}>
            {protein.protein_name ?? protein.accession}
          </h2>
          <span className="mono muted">{protein.entry_id}</span>
          <div style={{ flex: 1 }} />
          <a
            href={`https://alphafold.ebi.ac.uk/entry/${protein.accession}`}
            target="_blank"
            rel="noreferrer"
          >
            AlphaFold DB ↗
          </a>
          <a
            href={`https://www.uniprot.org/uniprotkb/${protein.accession}`}
            target="_blank"
            rel="noreferrer"
          >
            UniProt ↗
          </a>
        </div>

        <div className="stat-row" style={{ marginTop: 14 }}>
          <div>
            <span className="k">Gene</span>
            <span className="v">{protein.gene ?? '—'}</span>
          </div>
          <div>
            <span className="k">Organism</span>
            <span className="v">{protein.organism ?? '—'}</span>
          </div>
          <div>
            <span className="k">Length</span>
            <span className="v">{protein.sequence_length}</span>
          </div>
          <div>
            <span className="k">Mean pLDDT</span>
            <span className="v">{protein.mean_plddt?.toFixed(1) ?? '—'}</span>
          </div>
          <div>
            <span className="k">Very low (&lt;50)</span>
            <span className="v">{protein.pct_very_low?.toFixed(1) ?? '—'}%</span>
          </div>
          <div>
            <span className="k">Longest run &lt;70</span>
            <span className="v">{protein.longest_low_run ?? '—'}</span>
          </div>
          <div>
            <span className="k">Model version</span>
            <span className="v">v{protein.model_version ?? '?'}</span>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="panel">
          <h2>Predicted structure</h2>
          <StructureViewer accession={accession} url={api.structureUrl(accession)} />
          <div style={{ marginTop: 10 }}>
            <BandLegend />
          </div>
        </div>

        <div>
          <div className="panel">
            <h2>Per-residue confidence</h2>
            <ConfidenceTrack residues={residues} segments={segments} />
          </div>

          <div className="panel">
            <h2>Candidate disordered regions</h2>
            {segments.length === 0 ? (
              <p className="muted">
                No run of 8 or more residues falls below pLDDT 70 in this model.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Residues</th>
                      <th>Length</th>
                      <th>Mean pLDDT</th>
                      <th>Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {segments.map((segment) => (
                      <tr key={segment.segment_id}>
                        <td className="mono">
                          {segment.start_residue}–{segment.end_residue}
                        </td>
                        <td>{segment.length}</td>
                        <td>{segment.mean_plddt.toFixed(1)}</td>
                        <td>{segment.terminal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0 }}>Annotation</h2>
          <div style={{ flex: 1 }} />
          {annotation && (
            <span className="muted mono">
              {annotation.model} · {annotation.generated_at}
            </span>
          )}
          <button onClick={regenerate} disabled={regenerating}>
            {regenerating ? 'Generating…' : 'Regenerate'}
          </button>
        </div>

        {!annotation && (
          <p className="muted" style={{ marginTop: 12 }}>
            No card yet. Run <span className="mono">npm run annotate</span>, or press Regenerate —
            a local 8B model takes a minute or two per entry.
          </p>
        )}
        {annotation?.status === 'failed' && (
          <p className="error" style={{ marginTop: 12 }}>
            The model did not return a valid card: {annotation.error}
          </p>
        )}
        {annotation?.card && (
          <div style={{ marginTop: 12 }}>
            <Field label="Summary" value={annotation.card.summary} />
            <Field label="Confidence profile" value={annotation.card.confidence_profile} />
            <Field label="Disordered regions" value={annotation.card.disordered_regions} />
            <Field label="Caveats" value={annotation.card.caveats} />
            <div className="tags">
              {annotation.card.keywords.map((keyword) => (
                <span className="tag" key={keyword}>
                  {keyword}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-field">
      <div className="k">{label}</div>
      <div>{value}</div>
    </div>
  );
}
