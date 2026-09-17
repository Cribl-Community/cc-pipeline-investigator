import type { AnalysisReport, Finding, Severity } from '../types';

interface Props {
  report: AnalysisReport;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

function scoreClass(score: number): string {
  if (score >= 85) return 'score-good';
  if (score >= 60) return 'score-ok';
  return 'score-bad';
}

function scoreLabel(score: number): string {
  if (score >= 85) return 'Well optimized';
  if (score >= 60) return 'Room to improve';
  return 'Needs attention';
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

export function OptimizeReport({ report }: Props) {
  const counts = countBySeverity(report.findings);

  return (
    <div className="findings-tab">
      <div className="score-panel">
        <div className={`score-dial ${scoreClass(report.score)}`}>
          <span className="score-number">{report.score}</span>
          <span className="score-outof">/100</span>
        </div>
        <div className="score-meta">
          <div className="score-label">{scoreLabel(report.score)}</div>
          <div className="severity-summary">
            {(['high', 'medium', 'low', 'info'] as Severity[])
              .filter((s) => counts[s] > 0)
              .map((s) => (
                <span key={s} className={`pill sev-${s}`}>
                  {`${counts[s]} ${SEVERITY_LABEL[s]}`}
                </span>
              ))}
            {report.findings.length === 0 && (
              <span className="pill sev-success">No issues found</span>
            )}
          </div>
        </div>
      </div>

      {report.findings.length === 0 ? (
        <div className="optimize-empty">
          <div className="optimize-empty-icon" aria-hidden="true">🌱</div>
          <h3>This pipeline follows best practices</h3>
          <p>No optimization opportunities were detected. Nice work.</p>
        </div>
      ) : (
        <div className="findings-list">
          {report.findings.map((f, i) => (
            <FindingCard key={`${f.ruleId}-${i}`} finding={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <details className="finding-card" open={finding.severity === 'high'}>
      <summary className="finding-summary">
        <span className="finding-title">{finding.title}</span>
        <span className="finding-tags">
          <span className={`pill pill-bold sev-${finding.severity}`}>
            {SEVERITY_LABEL[finding.severity]}
          </span>
          <span className="pill pill-outline">{finding.category}</span>
        </span>
      </summary>

      <div className="finding-body">
        <p>{finding.detail}</p>

        <div className="recommendation-block">
          <div className="recommendation-heading">Recommendation</div>
          <p>{finding.recommendation}</p>
        </div>

        {finding.functions.length > 0 && (
          <div className="affected-functions">
            <div className="affected-heading">Affected functions</div>
            <div className="function-chips">
              {finding.functions.map((fn) => (
                <span key={fn.index} className="function-chip">
                  <span className="function-chip-index">#{fn.index + 1}</span>
                  {fn.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
