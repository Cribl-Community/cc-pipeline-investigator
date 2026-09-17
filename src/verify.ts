import type { CriblEvent } from './types';

// Cribl internal / bookkeeping fields that legitimately differ between preview
// runs and should be ignored when comparing output for equivalence.
const INTERNAL_FIELDS = new Set([
  '__cloneCount',
  '__criblEventType',
  '__ctrlFields',
  '__final',
  '__id',
  '__dropped',
  '__inputId',
  '__outputId',
  '__channel',
  '__srcIpPort',
  '__pi_idx', // Pipeline Investigator's per-event tracking field — never a real divergence.
  'cribl_pipe',
  'cribl_breaker',
]);

function stableStringify(event: CriblEvent): string {
  const keys = Object.keys(event)
    .filter((k) => !INTERNAL_FIELDS.has(k))
    .sort();
  const normalized: Record<string, unknown> = {};
  for (const k of keys) normalized[k] = event[k];
  return JSON.stringify(normalized);
}

export interface FieldDiff {
  key: string;
  original: string | undefined;
  optimized: string | undefined;
}

export interface EventDivergence {
  index: number;
  kind: 'only-original' | 'only-optimized' | 'field-mismatch';
  fields: FieldDiff[];
}

export interface VerificationResult {
  identical: boolean;
  originalCount: number;
  optimizedCount: number;
  comparedCount: number;
  divergences: EventDivergence[];
}

function fieldDiffs(a: CriblEvent, b: CriblEvent): FieldDiff[] {
  const keys = new Set(
    [...Object.keys(a), ...Object.keys(b)].filter((k) => !INTERNAL_FIELDS.has(k)),
  );
  const diffs: FieldDiff[] = [];
  for (const key of [...keys].sort()) {
    const av = key in a ? JSON.stringify(a[key]) : undefined;
    const bv = key in b ? JSON.stringify(b[key]) : undefined;
    if (av !== bv) diffs.push({ key, original: av, optimized: bv });
  }
  return diffs;
}

/**
 * Compare two preview outputs positionally. Because the safe transforms
 * (remove-disabled, merge-evals, reorder-reducers) never change which events
 * survive or their final field values, a behavior-preserving rewrite yields
 * identical output. Any divergence is surfaced for the user to inspect.
 *
 * Limited to the first `maxDivergences` differences to keep the UI readable.
 */
export function verifyEquivalence(
  originalOut: CriblEvent[],
  optimizedOut: CriblEvent[],
  maxDivergences = 20,
): VerificationResult {
  const divergences: EventDivergence[] = [];
  const compared = Math.max(originalOut.length, optimizedOut.length);

  for (let i = 0; i < compared; i++) {
    const o = originalOut[i];
    const p = optimizedOut[i];

    if (o && !p) {
      divergences.push({ index: i, kind: 'only-original', fields: fieldDiffs(o, {}) });
    } else if (!o && p) {
      divergences.push({ index: i, kind: 'only-optimized', fields: fieldDiffs({}, p) });
    } else if (o && p && stableStringify(o) !== stableStringify(p)) {
      divergences.push({ index: i, kind: 'field-mismatch', fields: fieldDiffs(o, p) });
    }

    if (divergences.length >= maxDivergences) break;
  }

  return {
    identical: divergences.length === 0 && originalOut.length === optimizedOut.length,
    originalCount: originalOut.length,
    optimizedCount: optimizedOut.length,
    comparedCount: compared,
    divergences,
  };
}
