import fs from 'node:fs';

/**
 * Reads the curated accession list. Lines may carry a trailing comment
 * (`P69905  HBA1  Hemoglobin subunit alpha`) — only the first token is used.
 */
export function readAccessions(file: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const accession = line.split(/\s+/)[0]!.toUpperCase();
    if (seen.has(accession)) continue;
    seen.add(accession);
    out.push(accession);
  }
  return out;
}
