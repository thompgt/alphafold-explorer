import { z } from 'zod';

/**
 * The annotation card. Every field is prose the UI shows verbatim, so the schema
 * enforces length bounds — an 8B model left unbounded will happily emit a page.
 */
export const annotationCardSchema = z.object({
  summary: z.string().min(20).max(600),
  confidence_profile: z.string().min(20).max(600),
  disordered_regions: z.string().min(3).max(600),
  caveats: z.string().min(3).max(600),
  keywords: z.array(z.string().min(2).max(40)).min(1).max(8),
});

export type AnnotationCard = z.infer<typeof annotationCardSchema>;

/** Parses a model response that is supposed to be a single JSON object. */
export function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const body = fenced ? fenced[1]! : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    // Models sometimes wrap JSON in a sentence; take the outermost braces.
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('model response contained no JSON object');
    return JSON.parse(body.slice(start, end + 1));
  }
}
