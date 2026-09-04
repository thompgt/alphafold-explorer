import { BANDS, type ProteinRow } from '../api.ts';

/** Stacked bar of the four AlphaFold confidence bands for one entry. */
export function ConfidenceBar({ protein }: { protein: ProteinRow }) {
  const parts = [
    { colour: BANDS[0].colour, pct: protein.pct_very_high ?? 0, label: BANDS[0].label },
    { colour: BANDS[1].colour, pct: protein.pct_confident ?? 0, label: BANDS[1].label },
    { colour: BANDS[2].colour, pct: protein.pct_low ?? 0, label: BANDS[2].label },
    { colour: BANDS[3].colour, pct: protein.pct_very_low ?? 0, label: BANDS[3].label },
  ];
  const total = parts.reduce((sum, part) => sum + part.pct, 0);
  if (total === 0) return <span className="muted">not summarised</span>;

  return (
    <div
      className="bar"
      title={parts.map((p) => `${p.label}: ${p.pct.toFixed(1)}%`).join('\n')}
      role="img"
      aria-label={`confidence bands for ${protein.accession}`}
    >
      {parts.map((part) => (
        <span
          key={part.colour}
          style={{ background: part.colour, width: `${(part.pct / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

export function BandLegend() {
  return (
    <div className="legend">
      {BANDS.map((band) => (
        <span key={band.key}>
          <i style={{ background: band.colour }} />
          {band.label}
        </span>
      ))}
    </div>
  );
}
