import type { AnalysisReport, Category, Finding, Pipeline, PipelineFunction, Severity } from './types';

// A friendly label for a function type id.
const FUNC_LABELS: Record<string, string> = {
  aggregate_metrics: 'Aggregate Metrics',
  aggregation: 'Aggregations',
  auto_timestamp: 'Auto Timestamp',
  cef: 'CEF Serializer',
  chain: 'Chain',
  clone: 'Clone',
  code: 'Code',
  comment: 'Comment',
  distinct: 'Distinct',
  dns_lookup: 'DNS Lookup',
  drop: 'Drop',
  drop_dimensions: 'Drop Dimensions',
  dynamic_sampling: 'Dynamic Sampling',
  eval: 'Eval',
  event_breaker: 'Event Breaker',
  eventstats: 'Eventstats',
  externaldata: 'External Data',
  flatten: 'Flatten',
  foldkeys: 'Flatten (Fold Keys)',
  gen_stats: 'Gen Stats',
  geoip: 'GeoIP',
  grok: 'Grok',
  handlebars: 'Handlebars',
  join: 'Join',
  json_unroll: 'JSON Unroll',
  lookup: 'Lookup',
  mask: 'Mask',
  numerify: 'Numerify',
  parser: 'Parser',
  redis: 'Redis',
  regex_extract: 'Regex Extract',
  regex_filter: 'Regex Filter',
  rename: 'Rename',
  rollup_metrics: 'Rollup Metrics',
  sampling: 'Sampling',
  sensitive_data_scanner: 'Sensitive Data Scanner',
  serde: 'Parser (Serde)',
  serialize: 'Serialize',
  sidlookup: 'SID Lookup',
  sort: 'Sort',
  suppress: 'Suppress',
  tee: 'Tee',
  trim_timestamp: 'Trim Timestamp',
  unroll: 'Unroll',
};

// One function paired with its absolute position in the pipeline.
interface IndexedFn {
  fn: PipelineFunction;
  index: number;
}

function label(fn: PipelineFunction): string {
  return FUNC_LABELS[fn.id] ?? fn.id;
}

function ref(item: IndexedFn): { index: number; label: string } {
  return { index: item.index, label: label(item.fn) };
}

// Function types that reduce event volume / size. Best placed early.
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

// Function types that are comparatively expensive per event. Best placed after
// volume-reduction, and best gated behind a filter.
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

// Blocking / high-latency calls to external systems, evaluated per event.
const EXTERNAL_IO = new Set(['dns_lookup', 'redis', 'externaldata', 'join']);

function noFilter(fn: PipelineFunction): boolean {
  const f = fn.filter?.trim();
  return !f || f === 'true';
}

// Static inspection of a Code function's JavaScript (stored in `conf.code`).
// Heuristic only — never executes the code — so it can flag common idioms that
// a purpose-built function does natively and recommend the swap. Everything is
// regex-based and defensive; a Code function whose body we can't classify just
// falls back to the generic "in use" advice.
interface CodeInspection {
  hasCode: boolean;
  assignsFields: boolean; // writes __e[...] / event.x
  deletesFields: boolean; // delete __e[...] / delete event.x
  hasLoop: boolean; // for / while / forEach / map / reduce
  hasFunctionDef: boolean; // function decl or arrow
  hasIf: boolean; // if(...) statement
  builtins: string[]; // built-in functions that cover detected idioms
  // True when the body only adds/removes fields (no loops or helper functions)
  // and is therefore a direct candidate for an Eval function.
  replaceableByEval: boolean;
}

function inspectCode(fn: PipelineFunction): CodeInspection {
  const empty: CodeInspection = {
    hasCode: false,
    assignsFields: false,
    deletesFields: false,
    hasLoop: false,
    hasFunctionDef: false,
    hasIf: false,
    builtins: [],
    replaceableByEval: false,
  };
  const raw = fn.conf?.code;
  const code = typeof raw === 'string' ? raw : '';
  if (!code.trim()) return empty;

  // Strip comments so keywords inside them don't trip the heuristics.
  const src = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  const assignsFields = /(?:__e|event)\s*(?:\[[^\]]+\]|\.[A-Za-z_$][\w$]*)\s*=(?!=)/.test(src);
  const deletesFields = /\bdelete\s+(?:__e|event)\b/.test(src);
  const hasLoop = /\b(?:for|while)\b|\.(?:forEach|map|reduce)\s*\(/.test(src);
  const hasFunctionDef = /\bfunction\b|=>/.test(src);
  const hasIf = /\bif\s*\(/.test(src);

  const hasDelete = /\bdelete\b/.test(src);

  const builtins: string[] = [];
  if (/JSON\s*\.\s*(?:parse|stringify)\s*\(/.test(src))
    builtins.push('the Parser function (JSON library) — to parse or reserialize structured data');
  if (/\.replace(?:All)?\s*\(/.test(src)) builtins.push('the Mask function — for find/replace and redaction');
  if (/\.match\s*\(|\.exec\s*\(|new\s+RegExp\s*\(/.test(src))
    builtins.push('the Regex Extract function — to capture regex groups into fields');
  // Moving values off one field onto another (assign + delete) is a rename.
  if (assignsFields && hasDelete)
    builtins.push('the Rename function — to rename fields (or an Eval for nested-path renames)');
  if (/new\s+Date\s*\(|Date\s*\.\s*parse\s*\(|\bstrptime\b/.test(src))
    builtins.push('the Auto Timestamp function, or C.Time.* inside an Eval, for timestamp parsing');

  const replaceableByEval = (assignsFields || deletesFields) && !hasLoop && !hasFunctionDef;

  return { hasCode: true, assignsFields, deletesFields, hasLoop, hasFunctionDef, hasIf, builtins, replaceableByEval };
}

interface RuleContext {
  enabled: IndexedFn[]; // enabled functions, in order, with absolute indices
  all: IndexedFn[]; // every function including disabled, with absolute indices
}

interface Rule {
  id: string;
  run(ctx: RuleContext): Finding[];
}

function finding(
  ruleId: string,
  severity: Severity,
  category: Category,
  title: string,
  detail: string,
  recommendation: string,
  functions: { index: number; label: string }[],
): Finding {
  return { ruleId, severity, category, title, detail, recommendation, functions };
}

const RULES: Rule[] = [
  {
    // Volume-reducing functions should come before expensive per-event work so
    // the heavy functions process fewer events.
    id: 'reduce-before-expensive',
    run({ enabled }) {
      const firstExpensiveAt = enabled.findIndex((e) => EXPENSIVE.has(e.fn.id));
      if (firstExpensiveAt === -1) return [];

      const lateReducers = enabled
        .slice(firstExpensiveAt + 1)
        .filter((e) => REDUCING.has(e.fn.id));
      if (lateReducers.length === 0) return [];

      const exp = enabled[firstExpensiveAt];
      // If the expensive function is already scoped by a filter it only pays the
      // cost for a subset of events, so the mis-ordering matters less.
      const expScoped = !noFilter(exp.fn);
      const scopeNote = expScoped
        ? ` (${label(exp.fn)} is scoped by a filter, so this only affects the events it matches).`
        : '.';
      return [
        finding(
          'reduce-before-expensive',
          expScoped ? 'medium' : 'high',
          'Ordering',
          'Volume reduction runs after expensive processing',
          `${label(exp.fn)} (an expensive per-event function) runs before ${lateReducers
            .map((e) => label(e.fn))
            .join(', ')}. Events that will ultimately be dropped or aggregated are still paying the cost of the expensive function${scopeNote}`,
          'Move volume-reducing functions (Drop, Sampling, Suppress, Aggregations, filters) ahead of expensive functions so they process the smallest possible event set.',
          [ref(exp), ...lateReducers.map(ref)],
        ),
      ];
    },
  },

  {
    // Expensive functions with no filter run on every event.
    id: 'unfiltered-expensive',
    run({ enabled }) {
      return enabled
        .filter((e) => EXPENSIVE.has(e.fn.id) && noFilter(e.fn))
        .map((e) =>
          finding(
            'unfiltered-expensive',
            'medium',
            'Performance',
            `${label(e.fn)} runs on every event`,
            `${label(e.fn)} has no filter expression, so it executes for every event passing through the pipeline. Expensive functions are often only needed for a subset of events.`,
            `Add a filter to ${label(e.fn)} so it only runs on the events that actually need it (e.g. scope by sourcetype, source, or a field check).`,
            [ref(e)],
          ),
        );
    },
  },

  {
    // Per-event external I/O is the most common latency source.
    id: 'external-io',
    run({ enabled }) {
      const io = enabled.filter((e) => EXTERNAL_IO.has(e.fn.id));
      if (io.length === 0) return [];
      return [
        finding(
          'external-io',
          io.some((e) => noFilter(e.fn)) ? 'high' : 'medium',
          'Performance',
          'Per-event calls to external systems',
          `This pipeline makes blocking external calls per event via ${io
            .map((e) => label(e.fn))
            .join(', ')}. Network latency here directly throttles pipeline throughput.`,
          'Cache results where possible (e.g. Redis/DNS TTLs), gate these functions behind a tight filter, and confirm the async function timeout is set appropriately. Prefer local Lookup files over network calls when the data is static.',
          io.map(ref),
        ),
      ];
    },
  },

  {
    // Code function is the most flexible but slowest option; native functions
    // are almost always faster. We statically inspect the JS body and, where we
    // recognise an idiom a built-in handles, recommend the specific swap.
    id: 'code-function',
    run({ enabled }) {
      return enabled
        .filter((e) => e.fn.id === 'code')
        .map((e) => {
          const c = inspectCode(e.fn);

          // Nothing we can map to a built-in — keep the general guidance. If the
          // body uses control flow / helper functions it may genuinely need Code,
          // so soften the severity; an unclassifiable/empty body stays medium.
          if (!c.replaceableByEval && c.builtins.length === 0) {
            const looksComplex = c.hasCode && (c.hasLoop || c.hasFunctionDef);
            return finding(
              'code-function',
              looksComplex ? 'low' : 'medium',
              'Performance',
              'Code function in use',
              looksComplex
                ? 'The Code function runs custom JavaScript on every event and is slower than purpose-built functions. This block uses loops or helper functions, so it may genuinely require Code — worth confirming against the built-ins.'
                : 'The Code function executes custom JavaScript per event and is slower than purpose-built functions. Cribl recommends reserving it for logic built-in functions cannot accomplish.',
              'Confirm the logic cannot be expressed with native functions (Eval, Lookup, Regex Extract, Mask, Parser). Reserve the Code function for cases built-in functions cannot handle, and keep a tight filter on it.',
              [ref(e)],
            );
          }

          // We recognised something. Describe what we saw and recommend the swap.
          const observed: string[] = [];
          if (c.replaceableByEval) {
            const ops = [c.assignsFields && 'sets event fields', c.deletesFields && 'removes event fields']
              .filter(Boolean)
              .join(' and ');
            observed.push(`this block only ${ops}${c.hasIf ? ' with conditional logic' : ''}`);
          }
          if (c.builtins.length) {
            observed.push(
              `it performs ${c.builtins.length === 1 ? 'an operation' : 'operations'} Cribl has a purpose-built function for`,
            );
          }

          const recs: string[] = [];
          if (c.replaceableByEval) {
            // Simple body — a direct Eval swap, plus any specific built-ins.
            const evalWhich =
              c.assignsFields && c.deletesFields
                ? 'an Eval function — use Add Fields for the assignments and Remove Fields for the deletes'
                : c.assignsFields
                  ? 'an Eval function (Add Fields)'
                  : 'an Eval function (Remove Fields)';
            recs.push(
              `Replace it with ${evalWhich}${
                c.hasIf ? ', expressing the conditionals as ternaries or a function-level filter.' : '.'
              }`,
            );
            for (const b of c.builtins) recs.push(`Use ${b}.`);
          } else {
            // Complex body (loops/helpers) but built-in idioms detected: recommend
            // decomposing into the equivalent function chain.
            recs.push(
              `Replace this Code function with the equivalent built-in ${
                c.builtins.length > 1 ? 'function chain' : 'function'
              }: ${c.builtins.join('; ')}.`,
            );
          }
          recs.push('These run far cheaper per event than custom JavaScript and are easier to maintain.');

          const multi = !c.replaceableByEval && c.builtins.length > 1;
          return finding(
            'code-function',
            'medium',
            'Performance',
            c.replaceableByEval
              ? 'Code function can be replaced with built-in functions'
              : multi
                ? 'Code function replicates a chain of built-in functions'
                : 'Code function overlaps with a built-in function',
            `The Code function executes custom JavaScript per event and is slower than purpose-built functions. Inspecting the code: ${observed.join('; ')}.`,
            recs.join(' '),
            [ref(e)],
          );
        });
    },
  },

  {
    // Consecutive unfiltered Eval functions can usually be merged.
    id: 'consecutive-evals',
    run({ enabled }) {
      const findings: Finding[] = [];
      let run: IndexedFn[] = [];
      const flush = () => {
        if (run.length >= 2) {
          findings.push(
            finding(
              'consecutive-evals',
              'low',
              'Maintainability',
              `${run.length} consecutive Eval functions`,
              `Functions ${run
                .map((e) => e.index + 1)
                .join(', ')} are all Eval functions running back to back. Each is a separate processing step.`,
              'Merge adjacent Eval functions into a single Eval with multiple Add/Remove rows. Fewer function boundaries means less per-event overhead and a simpler pipeline.',
              run.map(ref),
            ),
          );
        }
        run = [];
      };
      for (const e of enabled) {
        // A `final` eval short-circuits the pipeline, so it can't be merged with
        // whatever follows — end the run at (and including) it.
        if (e.fn.id === 'eval' && noFilter(e.fn) && !e.fn.final) {
          run.push(e);
        } else {
          if (e.fn.id === 'eval' && noFilter(e.fn) && e.fn.final) run.push(e);
          flush();
        }
      }
      flush();
      return findings;
    },
  },

  {
    // Disabled functions are dead weight and often signal forgotten debugging.
    id: 'disabled-functions',
    run({ all }) {
      // Comment functions are documentation with no per-event cost — never
      // flag them for removal, even when disabled.
      const disabled = all.filter((e) => e.fn.disabled && e.fn.id !== 'comment');
      if (disabled.length === 0) return [];
      return [
        finding(
          'disabled-functions',
          'low',
          'Maintainability',
          `${disabled.length} disabled function${disabled.length > 1 ? 's' : ''}`,
          `The pipeline contains disabled functions (${disabled
            .map((e) => label(e.fn))
            .join(', ')}). These add clutter and can hide intent.`,
          'Remove disabled functions once they are no longer needed. If kept intentionally, add a Comment explaining why.',
          disabled.map(ref),
        ),
      ];
    },
  },

  {
    // A `final` function short-circuits downstream processing, but ONLY for the
    // events that match its filter. Downstream functions are truly unreachable
    // only when the Final function is unconditional (no filter / filter `true`).
    // A filtered Final is normal routing — non-matching events still flow on — so
    // it must not be reported as a problem.
    id: 'unreachable-after-final',
    run({ enabled }) {
      // Find the first UNCONDITIONAL final function. A filtered one doesn't make
      // anything unreachable, so we skip past it.
      const finalAt = enabled.findIndex((e) => e.fn.final && noFilter(e.fn));
      if (finalAt === -1 || finalAt === enabled.length - 1) return [];
      const after = enabled.slice(finalAt + 1);
      const finalFn = enabled[finalAt];
      return [
        finding(
          'unreachable-after-final',
          'high',
          'Correctness',
          'Functions after an unconditional Final function are unreachable',
          `${label(finalFn.fn)} (function ${finalFn.index + 1}) has Final enabled with no filter, so it applies to every event and stops all downstream processing. The ${after.length} function${
            after.length > 1 ? 's' : ''
          } after it never execute.`,
          'Remove the unreachable functions, or add a filter to the Final function (or turn Final off) if the later functions are meant to run for some events.',
          after.map(ref),
        ),
      ];
    },
  },

  {
    // Sort / Join buffer events and break streaming.
    id: 'blocking-buffering',
    run({ enabled }) {
      return enabled
        .filter((e) => e.fn.id === 'sort' || e.fn.id === 'join')
        .map((e) =>
          finding(
            'blocking-buffering',
            'medium',
            'Performance',
            `${label(e.fn)} buffers events in memory`,
            `${label(e.fn)} must hold events in memory to do its work, which increases memory pressure and adds latency versus streaming functions.`,
            `Confirm ${label(e.fn)} is necessary in-stream. If you only need ordering/joining at rest, consider doing it at the destination or in Search instead.`,
            [ref(e)],
          ),
        );
    },
  },

  {
    // Cribl guidance: "Extract or parse by desired yield" — Regex Extract for a
    // few fields, Parser for many. Several Regex Extracts is a signal to switch.
    id: 'many-regex-extracts',
    run({ enabled }) {
      const rx = enabled.filter((e) => e.fn.id === 'regex_extract');
      if (rx.length < 3) return [];
      return [
        finding(
          'many-regex-extracts',
          'low',
          'Performance',
          `${rx.length} separate Regex Extract functions`,
          'Multiple Regex Extract functions each re-scan the event, and regex is one of the more CPU-intensive operations in a pipeline. Cribl recommends extracting "by desired yield": Regex Extract for a few fields, a Parser function when you need many.',
          'If the data is a recognized/structured format, replace the regex chain with a single Parser function. Otherwise, combine patterns that target the same field and anchor them to avoid catastrophic backtracking.',
          rx.map(ref),
        ),
      ];
    },
  },

  {
    // Cribl guidance: state is NOT shared across Workers. Aggregations, Suppress,
    // Sampling and Distinct operate per-process, so identical events landing on
    // different Workers won't be combined.
    id: 'cross-worker-state',
    run({ enabled }) {
      const stateful = enabled.filter((e) =>
        ['aggregation', 'suppress', 'distinct', 'rollup_metrics'].includes(e.fn.id),
      );
      if (stateful.length === 0) return [];
      return [
        finding(
          'cross-worker-state',
          'info',
          'Correctness',
          'Stateful functions do not share state across Workers',
          `${stateful
            .map((e) => label(e.fn))
            .join(', ')} keep state per Worker Process. Two matching events processed on different Workers will not be aggregated, suppressed, or de-duplicated together.`,
          'If cross-Worker accuracy matters, back these functions with a distributed cache such as Redis, or aggregate at a downstream tier. Otherwise, confirm per-Worker behavior is acceptable.',
          stateful.map(ref),
        ),
      ];
    },
  },

  {
    // Cribl guidance: "the more Functions you have, the longer it will take each
    // event to pass through." Flag unusually long pipelines.
    id: 'function-count',
    run({ enabled }) {
      if (enabled.length < 20) return [];
      return [
        finding(
          'function-count',
          'low',
          'Performance',
          `Long pipeline: ${enabled.length} enabled functions`,
          'Every function adds per-event processing time — the more functions, the longer each event takes to pass through. Very long pipelines are also harder to reason about.',
          'Look for functions that can be merged (e.g. multiple Evals), split unrelated processing into separate purpose-built pipelines, or move reusable logic into a Pack.',
          [],
        ),
      ];
    },
  },

  {
    // Cribl guidance: "Use comments to preserve legibility." A large pipeline
    // with no Comment functions and few descriptions is hard to maintain.
    id: 'legibility',
    run({ enabled, all }) {
      if (enabled.length < 8) return [];
      const hasComment = all.some((e) => e.fn.id === 'comment');
      const described = all.filter((e) => e.fn.description && e.fn.description.trim()).length;
      if (hasComment || described >= Math.ceil(all.length / 2)) return [];
      return [
        finding(
          'legibility',
          'info',
          'Maintainability',
          'Large pipeline has little inline documentation',
          'This pipeline has many functions but no Comment functions and few function descriptions. Context is easily lost as configurations grow.',
          'Add Comment functions or per-function descriptions to preserve legibility, following Cribl’s best-practice guidance.',
          [],
        ),
      ];
    },
  },

  {
    // No volume management at all on a large pipeline is worth noting.
    id: 'no-volume-reduction',
    run({ enabled }) {
      if (enabled.length < 5) return [];
      if (enabled.some((e) => REDUCING.has(e.fn.id))) return [];
      return [
        finding(
          'no-volume-reduction',
          'info',
          'Performance',
          'No volume-reduction functions detected',
          'This pipeline has no Drop, Sampling, Suppress, Aggregation, or filtering functions. Every event flows through all processing and out to the destination.',
          'Confirm all this data needs to be forwarded. Dropping null/noise fields, sampling verbose sources, or aggregating metrics can substantially cut downstream cost.',
          [],
        ),
      ];
    },
  },

  {
    // Async timeout awareness when the pipeline has async functions.
    id: 'async-timeout',
    run({ enabled }) {
      const hasAsync = enabled.some((e) => EXTERNAL_IO.has(e.fn.id) || e.fn.id === 'lookup');
      if (!hasAsync) return [];
      return [
        finding(
          'async-timeout',
          'info',
          'Correctness',
          'Pipeline uses asynchronous functions',
          'Async functions (lookups, external calls) are bounded by the pipeline Async Function Timeout. If it is too low, enrichment silently fails; too high, stalls back up.',
          'Review the Async Function Timeout in the pipeline settings and set it to a value that matches your slowest enrichment source.',
          [],
        ),
      ];
    },
  },
];

const SEVERITY_WEIGHT: Record<Severity, number> = { high: 20, medium: 10, low: 4, info: 0 };

export function analyzePipeline(pipeline: Pipeline): AnalysisReport {
  const all: IndexedFn[] = (pipeline.conf?.functions ?? []).map((fn, index) => ({ fn, index }));
  const enabled = all.filter((e) => !e.fn.disabled);

  const ctx: RuleContext = { enabled, all };

  const findings: Finding[] = [];
  for (const rule of RULES) {
    try {
      findings.push(...rule.run(ctx));
    } catch {
      // A single misbehaving rule should never break the whole analysis.
    }
  }

  const order: Severity[] = ['high', 'medium', 'low', 'info'];
  findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  const score = Math.max(0, 100 - penalty);

  return {
    pipelineId: pipeline.id,
    score,
    totalFunctions: all.length,
    enabledFunctions: enabled.length,
    findings,
  };
}

export { label as functionLabel };
