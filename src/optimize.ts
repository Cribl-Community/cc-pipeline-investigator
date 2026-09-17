import type { Pipeline, PipelineFunction } from './types';
import { functionLabel } from './rules';

// Function categories, kept in sync with rules.ts intent.
const REDUCING = new Set([
  'drop',
  'sampling',
  'dynamic_sampling',
  'suppress',
  'regex_filter',
  'aggregation',
  'rollup_metrics',
  'distinct',
]);

const EXPENSIVE = new Set([
  'lookup',
  'sidlookup',
  'dns_lookup',
  'geoip',
  'redis',
  'grok',
  'regex_extract',
  'mask',
  'code',
  'sensitive_data_scanner',
  'join',
]);

function noFilter(fn: PipelineFunction): boolean {
  const f = fn.filter?.trim();
  return !f || f === 'true';
}

export type ChangeType = 'remove' | 'merge' | 'reorder' | 'blocked';

export interface Change {
  type: ChangeType;
  description: string;
  rationale: string;
  // Original 1-based positions this change concerns, for display.
  positions: number[];
}

// A function being tracked through the optimization transforms. `origIndices`
// records which original (0-based) positions contributed — usually one, but a
// merge combines several.
interface WorkFn {
  fn: PipelineFunction;
  origIndices: number[];
}

export interface OptimizationResult {
  original: PipelineFunction[];
  optimized: PipelineFunction[];
  // For each optimized function, the original positions it came from (0-based).
  optimizedOrigIndices: number[][];
  // Original 0-based indices that were removed entirely.
  removedIndices: number[];
  changes: Change[];
  changed: boolean;
}

// Fields that always exist at pipeline input, before any function runs. A
// filter that references only these is safe to move to the front of the
// pipeline. Covers Cribl source/internal fields commonly used in filters.
const INPUT_FIELDS = new Set([
  '_raw',
  '_time',
  'source',
  'sourcetype',
  'host',
  'index',
  'level',
  'severity',
  'channel',
  'cribl_pipe',
  '__inputId',
  '__srcIpPort',
  'C', // Cribl expression helper namespace
  '__e',
  'event',
]);

// Pull root field identifiers referenced in a filter expression, e.g.
// "sourcetype=='x' && level > 2" -> {sourcetype, level}. Best-effort: we strip
// string/regex literals first so quoted values aren't mistaken for fields, and
// only capture the root of dotted/bracketed accesses.
function referencedFields(filter?: string): Set<string> {
  const out = new Set<string>();
  if (!filter) return out;
  // Remove single/double/backtick string literals so their contents aren't
  // parsed as identifiers.
  const stripped = filter
    .replace(/'(?:\\.|[^'\\])*'/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ');
  const KEYWORDS = new Set([
    'true',
    'false',
    'null',
    'undefined',
    'typeof',
    'new',
    'in',
    'instanceof',
    'return',
    'if',
    'else',
    'Math',
    'Date',
    'JSON',
    'String',
    'Number',
    'Boolean',
    'Array',
    'Object',
  ]);
  for (const m of stripped.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const token = m[0];
    // Skip property accesses like `.startsWith` (preceded by a dot).
    if (stripped[m.index! - 1] === '.') continue;
    // Skip function calls like `someFn(...)` — these are helpers, not fields.
    if (stripped[m.index! + token.length] === '(') continue;
    if (KEYWORDS.has(token)) continue;
    out.add(token);
  }
  return out;
}

// Fields a function is known to add/produce. We can only reliably know this for
// Eval (`conf.add[].name`); for enrichment functions we return null meaning
// "unknown", which the caller treats conservatively.
function producedFields(fn: PipelineFunction): Set<string> | null {
  if (fn.id === 'eval') {
    const add = (fn.conf?.add as { name?: string }[] | undefined) ?? [];
    return new Set(add.map((a) => a.name).filter((n): n is string => !!n));
  }
  // Enrichment functions produce fields we can't enumerate from config alone.
  if (['lookup', 'sidlookup', 'geoip', 'dns_lookup', 'regex_extract', 'grok', 'redis'].includes(fn.id)) {
    return null;
  }
  // Functions that don't add new fields (drop, sampling, serialize, etc.).
  return new Set();
}

function mergeEvals(a: PipelineFunction, b: PipelineFunction): PipelineFunction {
  const addA = (a.conf?.add as unknown[] | undefined) ?? [];
  const addB = (b.conf?.add as unknown[] | undefined) ?? [];
  const removeA = (a.conf?.remove as unknown[] | undefined) ?? [];
  const removeB = (b.conf?.remove as unknown[] | undefined) ?? [];
  const keepA = (a.conf?.keep as unknown[] | undefined) ?? [];
  const keepB = (b.conf?.keep as unknown[] | undefined) ?? [];
  return {
    ...a,
    conf: {
      ...a.conf,
      add: [...addA, ...addB],
      remove: [...removeA, ...removeB],
      keep: [...keepA, ...keepB],
    },
  };
}

export function optimizePipeline(pipeline: Pipeline): OptimizationResult {
  const original = pipeline.conf?.functions ?? [];
  const changes: Change[] = [];
  const removedIndices: number[] = [];

  // 1. Drop disabled functions — they never execute and only add clutter.
  //    Comment functions are exempt: they carry documentation, never touch
  //    events (no processing burden), so we keep them even when disabled.
  let work: WorkFn[] = [];
  original.forEach((fn, i) => {
    if (fn.disabled && fn.id !== 'comment') {
      removedIndices.push(i);
      changes.push({
        type: 'remove',
        description: `Remove disabled ${functionLabel(fn)} (function ${i + 1})`,
        rationale: 'Disabled functions never run. Removing them declutters the pipeline without changing behavior.',
        positions: [i + 1],
      });
    } else {
      work.push({ fn, origIndices: [i] });
    }
  });

  // 2. Merge runs of consecutive, unfiltered, non-final Eval functions.
  const merged: WorkFn[] = [];
  for (const item of work) {
    const prev = merged[merged.length - 1];
    const canMerge =
      prev &&
      prev.fn.id === 'eval' &&
      item.fn.id === 'eval' &&
      noFilter(prev.fn) &&
      noFilter(item.fn) &&
      !prev.fn.final &&
      !item.fn.final;
    if (canMerge) {
      prev.fn = mergeEvals(prev.fn, item.fn);
      prev.origIndices.push(...item.origIndices);
    } else {
      merged.push({ fn: { ...item.fn }, origIndices: [...item.origIndices] });
    }
  }
  for (const m of merged) {
    if (m.origIndices.length > 1) {
      const positions = m.origIndices.map((i) => i + 1);
      changes.push({
        type: 'merge',
        description: `Merge Eval functions ${positions.join(', ')} into one`,
        rationale:
          'Adjacent unfiltered Eval functions can be combined into a single Eval with multiple field rows. Fewer function boundaries means less per-event overhead.',
        positions,
      });
    }
  }
  work = merged;

  // 3. Reorder: pull volume-reducing functions ahead of the first expensive
  //    function — but only when it is safe. A move is blocked if the reducer's
  //    filter references a field produced by a function it would jump over
  //    (e.g. a Drop that tests a field an upstream Eval creates), or if any
  //    jumped function's produced fields are unknown (enrichment).
  const firstExpensiveAt = work.findIndex((w) => EXPENSIVE.has(w.fn.id));
  if (firstExpensiveAt !== -1) {
    // Process reducers that sit after the first expensive function, left to right.
    let insertAt = firstExpensiveAt;
    for (let i = firstExpensiveAt + 1; i < work.length; i++) {
      const cand = work[i];
      if (!REDUCING.has(cand.fn.id)) continue;

      const filterFields = referencedFields(cand.fn.filter);
      // Fields the reducer's filter depends on that are NOT guaranteed to exist
      // at input. Only these can create a move hazard.
      const derivedFields = [...filterFields].filter((f) => !INPUT_FIELDS.has(f));

      // Fields produced by everything between the insertion point and the candidate.
      let blocked = false;
      let unknownDependency = false;
      for (let j = insertAt; j < i; j++) {
        const produced = producedFields(work[j].fn);
        if (produced === null) {
          // Unknown producer (enrichment): only a hazard if the reducer's filter
          // references a derived (non-input) field that could come from it.
          if (derivedFields.length > 0) unknownDependency = true;
          continue;
        }
        for (const f of derivedFields) {
          if (produced.has(f)) blocked = true;
        }
      }

      const origPos = cand.origIndices.map((n) => n + 1);
      if (blocked || unknownDependency) {
        changes.push({
          type: 'blocked',
          description: `Keep ${functionLabel(cand.fn)} (function ${origPos.join(', ')}) where it is`,
          rationale: blocked
            ? `Its filter references a field created by an earlier function, so moving it ahead of ${functionLabel(work[firstExpensiveAt].fn)} would change results. Left in place.`
            : `Its filter may depend on fields added by an upstream enrichment function, so moving it can't be proven safe. Left in place — review manually.`,
          positions: origPos,
        });
        continue;
      }

      // Safe to move: splice the candidate out and insert it at insertAt.
      const [moved] = work.splice(i, 1);
      work.splice(insertAt, 0, moved);
      changes.push({
        type: 'reorder',
        description: `Move ${functionLabel(moved.fn)} (function ${origPos.join(', ')}) before ${functionLabel(
          work[insertAt + 1]?.fn ?? moved.fn,
        )}`,
        rationale:
          'Volume-reducing functions should run before expensive per-event processing so the heavy functions handle fewer events.',
        positions: origPos,
      });
      insertAt++;
    }
  }

  const optimized = work.map((w) => w.fn);
  const optimizedOrigIndices = work.map((w) => w.origIndices);

  return {
    original,
    optimized,
    optimizedOrigIndices,
    removedIndices,
    changes,
    changed: changes.some((c) => c.type !== 'blocked'),
  };
}
