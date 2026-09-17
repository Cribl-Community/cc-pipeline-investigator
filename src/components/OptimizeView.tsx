import { useMemo, useState } from 'react';
import type { Pipeline } from '../types';
import { analyzePipeline } from '../rules';
import { optimizePipeline } from '../optimize';
import { generateReplacement, type CodeRewrite } from '../codegen';
import { OptimizeReport } from './OptimizeReport';
import { OptimizeRecommendation } from './OptimizeRecommendation';

interface Props {
  pipeline: Pipeline;
  groupId: string;
}

type Tab = 'findings' | 'recommendation';

export function OptimizeView({ pipeline, groupId }: Props) {
  const [tab, setTab] = useState<Tab>('findings');

  const report = useMemo(() => analyzePipeline(pipeline), [pipeline]);
  const optimization = useMemo(() => optimizePipeline(pipeline), [pipeline]);

  // Best-effort draft rewrites of any Code functions we recognize, keyed by
  // their index in the original function list. Verify-gated, never auto-applied.
  const codeRewrites = useMemo(() => {
    const out: { index: number; rewrite: CodeRewrite }[] = [];
    pipeline.conf.functions.forEach((fn, i) => {
      const rewrite = generateReplacement(fn);
      if (rewrite) out.push({ index: i, rewrite });
    });
    return out;
  }, [pipeline]);

  const displayId = pipeline.id.includes(':') ? pipeline.id.split(':')[1] : pipeline.id;
  const disabledCount = report.totalFunctions - report.enabledFunctions;
  const changeCount = optimization.changes.filter((c) => c.type !== 'blocked').length;
  const recCount = changeCount + codeRewrites.length;

  return (
    <div className="optimize-view">
      <div className="optimize-header">
        <div>
          <h2>{displayId}</h2>
          <p className="optimize-subtitle">
            {report.enabledFunctions} enabled function{report.enabledFunctions === 1 ? '' : 's'}
            {disabledCount > 0 ? ` · ${disabledCount} disabled` : ''}
          </p>
        </div>
      </div>

      <div className="tab-bar" role="tablist">
        <button
          className={`btn ${tab === 'findings' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('findings')}
        >
          Findings ({report.findings.length})
        </button>
        <button
          className={`btn ${tab === 'recommendation' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('recommendation')}
        >
          {recCount > 0 ? `Recommended Pipeline (${recCount})` : 'Recommended Pipeline'}
        </button>
      </div>

      {tab === 'findings' ? (
        <OptimizeReport report={report} />
      ) : (
        <OptimizeRecommendation
          pipeline={pipeline}
          groupId={groupId}
          result={optimization}
          codeRewrites={codeRewrites}
        />
      )}
    </div>
  );
}
