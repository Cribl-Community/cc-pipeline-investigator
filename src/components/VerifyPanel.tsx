import { useEffect, useState } from 'react';
import type { CriblEvent, Pipeline, PipelineFunction, SampleFile } from '../types';
import { fetchSampleFiles, fetchSampleContent, previewOriginalAndOptimized } from '../api';
import { verifyEquivalence, type VerificationResult } from '../verify';

interface Props {
  pipeline: Pipeline;
  groupId: string;
  optimizedFunctions: PipelineFunction[];
}

type Phase = 'loading-samples' | 'ready' | 'verifying' | 'done' | 'error';

const shortId = (id: string) => (id.includes(':') ? id.split(':')[1] : id);

export function VerifyPanel({ pipeline, groupId, optimizedFunctions }: Props) {
  const [phase, setPhase] = useState<Phase>('loading-samples');
  const [samples, setSamples] = useState<SampleFile[]>([]);
  const [selectedSample, setSelectedSample] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [confirmRun, setConfirmRun] = useState(false);

  useEffect(() => {
    // Fetch-on-mount loads the group's sample files for the picker.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase('loading-samples');
    fetchSampleFiles(groupId)
      .then((files) => {
        setSamples(files);
        if (files.length > 0) setSelectedSample(files[0].id);
        setPhase('ready');
      })
      .catch((err) => {
        setError(String(err));
        setPhase('error');
      });
  }, [groupId]);

  const runVerification = async () => {
    setConfirmRun(false);
    setPhase('verifying');
    setError(null);
    setResult(null);
    try {
      const events: CriblEvent[] = await fetchSampleContent(groupId, selectedSample);
      if (events.length === 0) throw new Error('Sample file returned no events.');
      setEventCount(events.length);
      const { originalOut, optimizedOut } = await previewOriginalAndOptimized(
        groupId,
        pipeline.id,
        events,
        optimizedFunctions,
      );
      setResult(verifyEquivalence(originalOut, optimizedOut));
      setPhase('done');
    } catch (err) {
      setError(String(err));
      setPhase('error');
    }
  };

  const sampleLabel = (s: SampleFile) => {
    const name = s.sampleName || shortId(s.id);
    return s._packId ? `[${s._packId}] ${name}` : name;
  };

  const verifying = phase === 'verifying';

  return (
    <div className="verify-panel">
      <div className="verify-head">
        <h3>Test against a log file</h3>
        <p>
          Run a sample through the current and recommended pipelines, then compare the output
          to confirm the rewrite produces identical results on your data.
        </p>
      </div>

      {phase === 'loading-samples' && (
        <div className="verify-loading">Loading sample files…</div>
      )}

      {phase === 'error' && error && (
        <div className="alert alert-danger">
          <strong>Verification error</strong>
          <div>{error}</div>
        </div>
      )}

      {phase !== 'loading-samples' && samples.length === 0 && (
        <div className="alert alert-info">
          <strong>No sample files found</strong>
          <div>
            Add a sample or capture file to this worker group in Cribl, then reopen this tab to
            test against it.
          </div>
        </div>
      )}

      {samples.length > 0 && (
        <div className="verify-controls">
          <label className="verify-select-label">
            <span className="verify-select-caption">Sample file</span>
            <select
              className="verify-select"
              value={selectedSample}
              onChange={(e) => setSelectedSample(e.target.value)}
              disabled={verifying}
            >
              {samples.map((s) => (
                <option key={s.id} value={s.id}>
                  {sampleLabel(s)}
                  {s.numEvents ? ` (${s.numEvents} events)` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-primary"
            onClick={() => setConfirmRun(true)}
            disabled={verifying || !selectedSample}
          >
            {verifying ? 'Verifying…' : 'Run verification'}
          </button>
        </div>
      )}

      {confirmRun && (
        <div className="alert alert-info verify-confirm">
          <strong>Run the comparison preview?</strong>
          <p>
            Your live pipeline <strong>{shortId(pipeline.id)}</strong> is <strong>never modified</strong>.
            The app previews it read-only for the current output, then clones the recommended
            configuration into a throwaway pipeline (prefixed <code>pi_tmp_</code>) on worker group{' '}
            <strong>{groupId}</strong>, previews that, and deletes the clone when done. Any stray
            clone from an interrupted run is swept up on the next verification.
          </p>
          <div className="verify-confirm-actions">
            <button className="btn btn-primary" onClick={runVerification}>
              Run verification
            </button>
            <button className="btn btn-secondary" onClick={() => setConfirmRun(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && result && <VerdictView result={result} eventCount={eventCount} />}
    </div>
  );
}

function VerdictView({ result, eventCount }: { result: VerificationResult; eventCount: number }) {
  if (result.identical) {
    return (
      <div className="alert alert-success">
        <strong>Verified: identical output</strong>
        <div>
          The recommended pipeline produced the same {result.optimizedCount} output event
          {result.optimizedCount === 1 ? '' : 's'} as the current pipeline across {eventCount}{' '}
          sample event{eventCount === 1 ? '' : 's'}. The rewrite is behavior-preserving on this
          data.
        </div>
      </div>
    );
  }

  return (
    <div className="verdict-diff">
      <div className="alert alert-warning">
        <strong>Output differs — review before applying</strong>
        <div>
          The recommended pipeline produced different output on this sample ({result.originalCount}{' '}
          vs {result.optimizedCount} events). Showing the first {result.divergences.length}{' '}
          difference{result.divergences.length === 1 ? '' : 's'}.
        </div>
      </div>

      <div className="divergence-list">
        {result.divergences.map((d) => (
          <div key={d.index} className="divergence">
            <div className="divergence-head">
              <span className="divergence-title">Event {d.index + 1}</span>
              <span className="pill sev-medium">
                {d.kind === 'only-original'
                  ? 'Only in current'
                  : d.kind === 'only-optimized'
                    ? 'Only in recommended'
                    : 'Fields differ'}
              </span>
            </div>
            <table className="divergence-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Current</th>
                  <th>Recommended</th>
                </tr>
              </thead>
              <tbody>
                {d.fields.map((f) => (
                  <tr key={f.key}>
                    <td className="divergence-key">{f.key}</td>
                    <td>{f.original ?? <span className="divergence-absent">—</span>}</td>
                    <td>{f.optimized ?? <span className="divergence-absent">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
