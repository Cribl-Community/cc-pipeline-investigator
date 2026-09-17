import { useMemo } from 'react';
import type { OptimizationResult, Change, ChangeType } from '../optimize';
import type { CodeRewrite } from '../codegen';
import type { Pipeline, PipelineFunction } from '../types';
import { functionLabel } from '../rules';
import { VerifyPanel } from './VerifyPanel';

interface Props {
  pipeline: Pipeline;
  groupId: string;
  result: OptimizationResult;
  // Best-effort draft rewrites of Code functions, keyed by original index.
  codeRewrites: { index: number; rewrite: CodeRewrite }[];
}

const CHANGE_LABEL: Record<ChangeType, string> = {
  reorder: 'Reordered',
  merge: 'Merged',
  remove: 'Removed',
  blocked: 'Left as-is',
};

function fnFilter(fn: PipelineFunction): string | null {
  const f = fn.filter?.trim();
  return !f || f === 'true' ? null : f;
}

type Annotation = 'removed' | 'moved' | 'merged' | 'same' | 'generated';

// A row in the Recommended column: the function to show, whether it was
// generated from a Code function, and which original rows it derives from.
interface RecRow {
  fn: PipelineFunction;
  ann: Annotation;
  origIndices: number[];
}

export function OptimizeRecommendation({ pipeline, groupId, result, codeRewrites }: Props) {
  const { original, optimized, optimizedOrigIndices, removedIndices, changes, changed } = result;
  const hasDraft = codeRewrites.length > 0;

  // Annotate each original row as removed / merged / moved / same. A row is
  // "moved" when its rank among surviving functions differs between the
  // original order and the optimized order.
  const origStatus = useMemo(() => {
    const status = new Map<number, Annotation>();
    for (const i of removedIndices) status.set(i, 'removed');

    const removed = new Set(removedIndices);
    const survivingOriginalOrder = optimizedOrigIndices
      .flat()
      .filter((o) => !removed.has(o))
      .sort((a, b) => a - b);
    const optimizedOrder = optimizedOrigIndices.flat();

    optimizedOrigIndices.forEach((origs) => {
      if (origs.length > 1) {
        for (const o of origs) status.set(o, 'merged');
        return;
      }
      const o = origs[0];
      status.set(o, survivingOriginalOrder.indexOf(o) === optimizedOrder.indexOf(o) ? 'same' : 'moved');
    });
    return status;
  }, [optimizedOrigIndices, removedIndices]);

  // The Recommended column and the Verify/Export targets. Start from the
  // provably-safe `optimized` list, then splice each generated draft in place
  // of the Code function it replaces (matched back through optimizedOrigIndices).
  const recRows = useMemo<RecRow[]>(() => {
    const rewriteByOrig = new Map(codeRewrites.map((cr) => [cr.index, cr.rewrite]));
    const rows: RecRow[] = [];
    optimized.forEach((fn, i) => {
      const origs = optimizedOrigIndices[i] ?? [];
      const rewrite = origs.length === 1 ? rewriteByOrig.get(origs[0]) : undefined;
      if (rewrite) {
        for (const g of rewrite.functions) {
          rows.push({ fn: g, ann: 'generated', origIndices: origs });
        }
      } else {
        rows.push({ fn, ann: origs.length > 1 ? 'merged' : 'same', origIndices: origs });
      }
    });
    return rows;
  }, [optimized, optimizedOrigIndices, codeRewrites]);

  const draftFunctions = useMemo(() => recRows.map((r) => r.fn), [recRows]);

  const handleExport = () => {
    // Suffix the exported pipeline id with `_new` so importing it into Cribl
    // creates a separate pipeline instead of overwriting the original.
    const base = pipeline.id.includes(':') ? pipeline.id.split(':')[1] : pipeline.id;
    const newId = `${base}_new`;
    const exportData = { ...pipeline, id: newId, conf: { ...pipeline.conf, functions: draftFunctions } };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${newId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const applied = changes.filter((c) => c.type !== 'blocked');
  const blocked = changes.filter((c) => c.type === 'blocked');

  if (!changed && blocked.length === 0 && !hasDraft) {
    return (
      <div className="optimize-empty">
        <div className="optimize-empty-icon" aria-hidden="true">🌱</div>
        <h3>No structural changes recommended</h3>
        <p>
          This pipeline's function set and ordering already look efficient. See the Findings tab
          for any remaining advisory notes.
        </p>
      </div>
    );
  }

  const canVerify = changed || hasDraft;

  return (
    <div className="recommendation">
      {(changed || blocked.length > 0) && (
        <div className="alert alert-info">
          <strong>This is a proposed rewrite — review before applying</strong>
          <div>
            The optimizer only rewrites changes it can prove are behavior-preserving (removing
            disabled functions, merging adjacent Evals, and reordering volume reducers whose filters
            use input fields). It never applies changes to your worker group. Export the JSON and
            review it in Cribl before saving.
          </div>
        </div>
      )}

      {hasDraft && (
        <div className="alert alert-warning">
          <strong>Generated Code-function replacement — draft, not proven equivalent</strong>
          <div>
            The Recommended pipeline below replaces {codeRewrites.length === 1 ? 'a Code function' : `${codeRewrites.length} Code functions`} with
            built-in functions generated by pattern-matching common idioms (JSON parse, field
            add/remove, renames, regex replace/extract). This is a <strong>best-effort draft</strong>,
            not a proven-equivalent rewrite — some Code cannot be expressed with built-ins. Use{' '}
            <strong>Verify</strong> below to compare the original and draft field-for-field against a
            real sample, and review every note before use.
          </div>
        </div>
      )}

      {codeRewrites.map((cr) => (
        <div className="draft-rewrite" key={cr.index}>
          <h3>
            Draft for Code function #{cr.index + 1}
            {cr.rewrite.fullyTranslated ? '' : ' — partial'}
          </h3>
          <p className="draft-chain">
            {cr.rewrite.functions.map((g) => functionLabel(g)).join('  →  ') || 'no built-ins generated'}
          </p>
          {cr.rewrite.notes.length > 0 && (
            <ul className="draft-notes">
              {cr.rewrite.notes.map((n, j) => (
                <li key={j}>{n}</li>
              ))}
            </ul>
          )}
          {cr.rewrite.fullyTranslated && (
            <p className="draft-clean">
              All recognized idioms were translated. Still verify before use.
            </p>
          )}
        </div>
      ))}

      {applied.length > 0 && (
        <div className="change-summary">
          <h3>Recommended changes ({applied.length})</h3>
          <div className="change-list">
            {applied.map((c, i) => (
              <ChangeRow key={i} change={c} />
            ))}
          </div>
        </div>
      )}

      {blocked.length > 0 && (
        <div className="change-summary">
          <h3>Suggested, but left for you to decide ({blocked.length})</h3>
          <div className="change-list">
            {blocked.map((c, i) => (
              <ChangeRow key={i} change={c} />
            ))}
          </div>
        </div>
      )}

      <div className="diff-columns">
        <PipelineColumn
          title="Current"
          functions={original}
          annotate={(i) => origStatus.get(i) ?? 'same'}
          numbering="original"
        />
        <PipelineColumn
          title={hasDraft ? 'Recommended (draft)' : 'Recommended'}
          functions={recRows.map((r) => r.fn)}
          annotate={(i) => recRows[i]?.ann ?? 'same'}
          numbering="optimized"
          origIndices={recRows.map((r) => r.origIndices)}
        />
      </div>

      {canVerify && (
        <VerifyPanel pipeline={pipeline} groupId={groupId} optimizedFunctions={draftFunctions} />
      )}

      <div className="recommendation-actions">
        <button className="btn btn-primary" onClick={handleExport} disabled={!canVerify}>
          Export {hasDraft ? 'draft' : 'optimized'} JSON
        </button>
      </div>
    </div>
  );
}

function ChangeRow({ change }: { change: Change }) {
  return (
    <div className="change-row">
      <div className="change-row-head">
        <span className={`pill change-${change.type}`}>{CHANGE_LABEL[change.type]}</span>
        <span className="change-desc">{change.description}</span>
      </div>
      <p className="change-rationale">{change.rationale}</p>
    </div>
  );
}

function PipelineColumn({
  title,
  functions,
  annotate,
  numbering,
  origIndices,
}: {
  title: string;
  functions: PipelineFunction[];
  annotate: (index: number) => Annotation;
  numbering: 'original' | 'optimized';
  origIndices?: number[][];
}) {
  return (
    <div className="pipeline-column">
      <h4>{title}</h4>
      <ol className="fn-list">
        {functions.map((fn, i) => {
          const ann = annotate(i);
          const filter = fnFilter(fn);
          const fromLabel =
            numbering === 'optimized' && origIndices && origIndices[i]?.length
              ? `#${origIndices[i].map((o) => o + 1).join('+')}`
              : `#${i + 1}`;
          return (
            <li key={i} className={`fn-row fn-${ann}`}>
              <span className="fn-pos">{fromLabel}</span>
              <div className="fn-body">
                <div className="fn-title-row">
                  <span className="fn-label">{functionLabel(fn)}</span>
                  {fn.final && <span className="fn-flag">final</span>}
                  {ann === 'removed' && <span className="fn-ann fn-ann-removed">removed</span>}
                  {ann === 'moved' && <span className="fn-ann fn-ann-moved">moved</span>}
                  {ann === 'merged' && <span className="fn-ann fn-ann-merged">merged</span>}
                  {ann === 'generated' && <span className="fn-ann fn-ann-generated">generated</span>}
                </div>
                {filter && (
                  <span className="fn-filter" title={filter}>
                    filter: {filter}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
