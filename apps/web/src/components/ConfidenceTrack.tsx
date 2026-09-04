import { useMemo, useRef, useState } from 'react';
import { bandColour, type Residue, type Segment } from '../api.ts';

interface Props {
  residues: Residue[];
  segments: Segment[];
}

/**
 * Per-residue pLDDT drawn as a one-pixel-per-residue strip, with candidate
 * disordered segments underlined beneath it. Rendered as SVG rather than a chart
 * library: it is one rectangle per residue and needs to stay readable at 1500 wide.
 */
export function ConfidenceTrack({ residues, segments }: Props) {
  const [hover, setHover] = useState<Residue | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const width = residues.length;
  const bars = useMemo(
    () =>
      residues.map((residue) => ({
        x: residue.residue_index - 1,
        height: Math.max(1, (residue.plddt / 100) * 34),
        colour: bandColour(residue.plddt),
      })),
    [residues],
  );

  if (residues.length === 0) return <p className="muted">No per-residue data stored.</p>;

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const index = Math.floor(((event.clientX - rect.left) / rect.width) * residues.length);
    setHover(residues[Math.min(Math.max(index, 0), residues.length - 1)] ?? null);
  }

  return (
    <div>
      <svg
        ref={svgRef}
        className="track"
        viewBox={`0 0 ${width} 46`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {bars.map((bar) => (
          <rect
            key={bar.x}
            x={bar.x}
            y={34 - bar.height}
            width={1}
            height={bar.height}
            fill={bar.colour}
          />
        ))}
        {segments.map((segment) => (
          <rect
            key={segment.segment_id}
            x={segment.start_residue - 1}
            y={39}
            width={segment.length}
            height={4}
            fill="#ff7d45"
            opacity={0.85}
          >
            <title>
              {`candidate disordered region ${segment.start_residue}-${segment.end_residue} (${segment.terminal})`}
            </title>
          </rect>
        ))}
      </svg>
      <div className="muted mono" style={{ minHeight: 18 }}>
        {hover
          ? `residue ${hover.residue_index} ${hover.amino_acid} — pLDDT ${hover.plddt}`
          : `${residues.length} residues; the orange underline marks candidate disordered regions`}
      </div>
    </div>
  );
}
