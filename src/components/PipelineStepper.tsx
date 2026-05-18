import { useState, useCallback } from 'react';
import type { Pipeline, PipelineFunction, CriblEvent, StepResult } from '../types';
import { previewPipeline, previewPipelineBatch, savePipeline } from '../api';
import { EventDiff } from './EventDiff';
import { FunctionConfig } from './FunctionConfig';
import { SampleInput, type SampleSelection } from './SampleInput';

interface Props {
  pipeline: Pipeline;
  groupId: string;
  sampleId: string;
  sampleEvents: CriblEvent[];
  onSampleChange: (selection: SampleSelection) => void;
}

export function PipelineStepper({ pipeline, groupId, sampleId, sampleEvents, onSampleChange }: Props) {
  const [currentStep, setCurrentStep] = useState(-1);
  const [stepResults, setStepResults] = useState<StepResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editedFunctions, setEditedFunctions] = useState<PipelineFunction[]>(pipeline.conf.functions);
  const [showSamplePicker, setShowSamplePicker] = useState(false);

  const activeFunctions = editedFunctions.filter(f => !f.disabled);

  // Map active function index to the index in editedFunctions (all)
  const activeToAllIdx: number[] = [];
  editedFunctions.forEach((fn, i) => { if (!fn.disabled) activeToAllIdx.push(i); });

  const runAllSteps = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const stepIndices = activeFunctions.map((_, i) => activeToAllIdx[i]);
      const batchResults = await previewPipelineBatch(groupId, pipeline.id, sampleId, sampleEvents, editedFunctions, stepIndices);
      const results: StepResult[] = batchResults.map((r, i) => ({
        stepIndex: i, events: r.events, droppedEvents: r.droppedEvents,
      }));
      setStepResults(results);
      setCurrentStep(0);
    } catch (err) {
      setError(String(err));
    }

    setLoading(false);
  }, [activeFunctions, editedFunctions, activeToAllIdx, groupId, pipeline.id, sampleId, sampleEvents]);

  const runNextStep = useCallback(async () => {
    const nextIdx = stepResults.length;
    if (nextIdx >= activeFunctions.length) return;

    setLoading(true);
    setError(null);
    const allIdx = activeToAllIdx[nextIdx];

    try {
      const result = await previewPipeline(groupId, pipeline.id, sampleId, sampleEvents, editedFunctions, allIdx);
      setStepResults(prev => [...prev, { stepIndex: nextIdx, events: result.events, droppedEvents: result.droppedEvents }]);
    } catch (err) {
      setStepResults(prev => [...prev, { stepIndex: nextIdx, events: [], droppedEvents: [], error: String(err) }]);
    }

    setCurrentStep(nextIdx);
    setLoading(false);
  }, [activeFunctions, editedFunctions, activeToAllIdx, stepResults, groupId, pipeline.id, sampleId, sampleEvents]);

  const runCurrentStep = useCallback(async () => {
    if (currentStep < 0 || currentStep >= activeFunctions.length) return;

    setLoading(true);
    setError(null);
    const allIdx = activeToAllIdx[currentStep];

    try {
      const result = await previewPipeline(groupId, pipeline.id, sampleId, sampleEvents, editedFunctions, allIdx);
      setStepResults(prev => {
        const updated = [...prev];
        updated[currentStep] = { stepIndex: currentStep, events: result.events, droppedEvents: result.droppedEvents };
        return updated;
      });
    } catch (err) {
      setStepResults(prev => {
        const updated = [...prev];
        updated[currentStep] = { stepIndex: currentStep, events: [], droppedEvents: [], error: String(err) };
        return updated;
      });
    }

    setLoading(false);
  }, [currentStep, activeFunctions, editedFunctions, activeToAllIdx, groupId, pipeline.id, sampleId, sampleEvents]);

  const handleFunctionUpdate = (allIdx: number, updated: PipelineFunction) => {
    const newFunctions = [...editedFunctions];
    newFunctions[allIdx] = updated;
    setEditedFunctions(newFunctions);
    const activeIdx = activeToAllIdx.indexOf(allIdx);
    if (activeIdx >= 0) {
      setStepResults(prev => prev.slice(0, activeIdx));
    }
  };

  const handleToggleDisable = (allIdx: number) => {
    const newFunctions = [...editedFunctions];
    newFunctions[allIdx] = { ...newFunctions[allIdx], disabled: !newFunctions[allIdx].disabled };
    setEditedFunctions(newFunctions);
    setStepResults([]);
  };

  const handleResetFunctions = () => {
    setEditedFunctions(pipeline.conf.functions);
    setStepResults([]);
  };

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);

  const handleSave = async () => {
    if (!confirmSave) {
      setConfirmSave(true);
      return;
    }
    setConfirmSave(false);
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      await savePipeline(groupId, pipeline.id, editedFunctions);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSampleReady = (selection: SampleSelection) => {
    onSampleChange(selection);
    setShowSamplePicker(false);
    setStepResults([]);
  };

  const handleExport = () => {
    const exportData = { ...pipeline, conf: { ...pipeline.conf, functions: editedFunctions } };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pipeline.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getPreviousEvents = (): CriblEvent[] => {
    if (currentStep <= 0) return sampleEvents;
    return stepResults[currentStep - 1]?.events ?? sampleEvents;
  };

  const getCurrentEvents = (): CriblEvent[] => {
    if (currentStep < 0) return sampleEvents;
    return stepResults[currentStep]?.events ?? [];
  };

  const getFunctionLabel = (fn: PipelineFunction): string => {
    return fn.description || fn.id || 'Unknown Function';
  };

  const currentResult = currentStep >= 0 ? stepResults[currentStep] : null;
  const prevEvents = getPreviousEvents();
  const droppedCount = currentResult ? prevEvents.length - currentResult.events.length : 0;
  const hasDropped = droppedCount > 0;
  const passedFilter = currentResult && currentResult.events.length > 0;

  const hasEdits = JSON.stringify(editedFunctions) !== JSON.stringify(pipeline.conf.functions);

  return (
    <div className="stepper-container">
      <div className="stepper-header">
        <h2>Pipeline: {pipeline.id}</h2>
        {pipeline.conf.description && (
          <p className="pipeline-description">{pipeline.conf.description}</p>
        )}
        <div className="header-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setShowSamplePicker(!showSamplePicker)}
          >
            {showSamplePicker ? 'Hide Sample Picker' : 'Change Sample'}
          </button>
          {hasEdits && (
            <>
              <button className="btn btn-secondary" onClick={handleResetFunctions}>
                Reset Changes
              </button>
              <button className="btn btn-secondary" onClick={handleExport}>
                Export JSON
              </button>
              {confirmSave ? (
                <>
                  <span className="confirm-message">Overwrite pipeline config?</span>
                  <button className="btn btn-save" onClick={handleSave}>Yes, Save</button>
                  <button className="btn btn-secondary" onClick={() => setConfirmSave(false)}>Cancel</button>
                </>
              ) : (
                <button
                  className="btn btn-save"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save to Worker Group'}
                </button>
              )}
            </>
          )}
          <button
            className="btn btn-primary"
            onClick={runAllSteps}
            disabled={loading || sampleEvents.length === 0}
          >
            {loading ? 'Running...' : 'Run All Steps'}
          </button>
        </div>
      </div>

      {showSamplePicker && (
        <SampleInput groupId={groupId} onSampleReady={handleSampleReady} />
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="stepper-body">
        <div className="function-list">
          <div
            className={`function-item ${currentStep === -1 ? 'active' : ''}`}
            onClick={() => setCurrentStep(-1)}
          >
            <span className="step-number">0</span>
            <span className="step-label">Input ({sampleEvents.length} event{sampleEvents.length !== 1 ? 's' : ''})</span>
          </div>
          {editedFunctions.map((fn, allIdx) => {
            const activeIdx = activeToAllIdx.indexOf(allIdx);
            const result = activeIdx >= 0 ? stepResults[activeIdx] : null;
            const prevStepEvents = activeIdx === 0 ? sampleEvents : (stepResults[activeIdx - 1]?.events ?? []);
            const unchanged = result && result.events.length === prevStepEvents.length &&
              JSON.stringify(result.events) === JSON.stringify(prevStepEvents);
            const dropped = result && result.events.length < prevStepEvents.length;
            return (
              <div
                key={allIdx}
                className={`function-item ${currentStep === activeIdx ? 'active' : ''} ${result?.error ? 'has-error' : ''} ${dropped ? 'has-drop' : ''} ${fn.disabled ? 'is-disabled' : ''}`}
                onClick={() => {
                  if (fn.disabled) {
                    setCurrentStep(-2 - allIdx);
                  } else {
                    setCurrentStep(activeIdx);
                  }
                }}
              >
                <span className="step-number">{fn.disabled ? '—' : activeIdx + 1}</span>
                <div className="step-info">
                  <span className="step-label">{getFunctionLabel(fn)}</span>
                  {fn.filter && fn.filter !== 'true' && (
                    <span className="step-filter" title={fn.filter}>filter: {fn.filter}</span>
                  )}
                </div>
                <div className="step-badges">
                  <span className="step-type">{fn.id}</span>
                  {fn.disabled && <span className="badge badge-disabled">disabled</span>}
                  {!fn.disabled && !result && activeIdx < stepResults.length && <span className="badge badge-skip">no change</span>}
                  {!fn.disabled && !result && activeIdx >= stepResults.length && stepResults.length > 0 && <span className="badge badge-stale">needs re-run</span>}
                  {!fn.disabled && result && unchanged && <span className="badge badge-skip">no change</span>}
                  {!fn.disabled && dropped && <span className="badge badge-drop">dropped</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="step-detail">
          {currentStep === -1 && (
            <div className="step-results">
              <div className="config-section">
                <h4>Input Sample ({sampleEvents.length} event{sampleEvents.length !== 1 ? 's' : ''})</h4>
                <pre className="raw-json">{JSON.stringify(sampleEvents, null, 2)}</pre>
              </div>
              {stepResults.length === 0 && !loading && (
                <div className="empty-state">
                  Click "Run All Steps" to see how each function transforms your data.
                </div>
              )}
            </div>
          )}

          {/* Showing a disabled function's config (currentStep encoded as -2 - allIdx) */}
          {currentStep < -1 && (
            <div className="step-results">
              <FunctionConfig
                fn={editedFunctions[-2 - currentStep]}
                pipeline={pipeline}
                onUpdate={(updated) => handleFunctionUpdate(-2 - currentStep, updated)}
                onToggleDisable={() => handleToggleDisable(-2 - currentStep)}
              />
            </div>
          )}

          {loading && (
            <div className="loading-state">
              Processing step {stepResults.length + 1} of {activeFunctions.length}...
            </div>
          )}

          {currentStep >= 0 && (
            <div className="step-results">
              <div className="step-nav">
                <button
                  className="btn btn-secondary"
                  disabled={currentStep <= -1}
                  onClick={() => setCurrentStep(Math.max(-1, currentStep - 1))}
                >
                  Previous
                </button>
                <span className="step-indicator">
                  Step {currentStep + 1} of {activeFunctions.length}
                </span>
                <button
                  className="btn btn-secondary"
                  disabled={currentStep >= activeFunctions.length - 1}
                  onClick={() => setCurrentStep(Math.min(activeFunctions.length - 1, currentStep + 1))}
                >
                  Next
                </button>
                <button
                  className="btn btn-primary"
                  onClick={runCurrentStep}
                  disabled={loading}
                >
                  {loading ? 'Running...' : 'Re-run Step'}
                </button>
              </div>

              <FunctionConfig
                fn={activeFunctions[currentStep]}
                pipeline={pipeline}
                onUpdate={(updated) => handleFunctionUpdate(activeToAllIdx[currentStep], updated)}
                onToggleDisable={() => handleToggleDisable(activeToAllIdx[currentStep])}
              />

              {currentResult && (
                <div className="step-status">
                  <span className="status-label">Events in:</span>
                  <span className="status-count">{prevEvents.length}</span>
                  <span className="status-arrow">&rarr;</span>
                  <span className="status-label">Events out:</span>
                  <span className={`status-count ${!passedFilter ? 'status-zero' : ''}`}>
                    {currentResult.events.length}
                  </span>
                  {hasDropped && (
                    <>
                      <span className="status-label status-dropped">Dropped:</span>
                      <span className="status-count status-zero">{droppedCount}</span>
                    </>
                  )}
                  {!passedFilter && prevEvents.length > 0 && (
                    <span className="status-message">
                      Events did not pass through this function (filtered out or dropped)
                    </span>
                  )}
                </div>
              )}

              {currentResult?.error && (
                <div className="error-banner">
                  {currentResult.error}
                </div>
              )}

              {currentResult && !loading && (
                <EventDiff
                  before={getPreviousEvents()}
                  after={getCurrentEvents()}
                  stepLabel={`After: ${getFunctionLabel(activeFunctions[currentStep])}`}
                />
              )}

              {!currentResult && !loading && (
                <div className="empty-state">
                  Click "Re-run Step" to see results.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
