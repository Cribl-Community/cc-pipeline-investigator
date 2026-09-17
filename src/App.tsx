import { useState } from 'react';
import type { Pipeline, CriblEvent } from './types';
import { ModeSelector, type Mode } from './components/ModeSelector';
import { PipelineSelector } from './components/PipelineSelector';
import { SampleInput, type SampleSelection } from './components/SampleInput';
import { PipelineInvestigator } from './components/PipelineInvestigator';
import { OptimizeView } from './components/OptimizeView';

const MODE_LABEL: Record<Mode, string> = {
  investigate: 'Investigate',
  optimize: 'Optimize',
};

function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [groupId, setGroupId] = useState('');
  const [sampleId, setSampleId] = useState('');
  const [sampleEvents, setSampleEvents] = useState<CriblEvent[]>([]);

  const handlePipelineSelected = (p: Pipeline, gId: string) => {
    setPipeline(p);
    setGroupId(gId);
  };

  const handleSampleReady = (selection: SampleSelection) => {
    setSampleId(selection.sampleId);
    setSampleEvents(selection.events);
  };

  const clearPipelineState = () => {
    setPipeline(null);
    setGroupId('');
    setSampleId('');
    setSampleEvents([]);
  };

  const handleChangeMode = () => {
    clearPipelineState();
    setMode(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>Pipeline Investigator</h1>
          {mode && <span className="app-mode-tag">{MODE_LABEL[mode]}</span>}
        </div>
        <div className="app-header-actions">
          {mode === 'investigate' && pipeline && (
            <button className="btn btn-secondary" onClick={clearPipelineState}>
              Change Pipeline
            </button>
          )}
          {mode === 'optimize' && pipeline && (
            <button className="btn btn-secondary" onClick={clearPipelineState}>
              Analyze Another
            </button>
          )}
          {mode && (
            <button className="btn btn-secondary" onClick={handleChangeMode}>
              ⌂ Start over
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        {!mode && <ModeSelector onSelect={setMode} />}

        {mode === 'investigate' && (
          <>
            {!pipeline && <PipelineSelector onPipelineSelected={handlePipelineSelected} />}

            {pipeline && sampleEvents.length === 0 && (
              <SampleInput groupId={groupId} onSampleReady={handleSampleReady} />
            )}

            {pipeline && sampleEvents.length > 0 && (
              <PipelineInvestigator
                pipeline={pipeline}
                groupId={groupId}
                sampleId={sampleId}
                sampleEvents={sampleEvents}
                onSampleChange={handleSampleReady}
              />
            )}
          </>
        )}

        {mode === 'optimize' && (
          <>
            {!pipeline && <PipelineSelector onPipelineSelected={handlePipelineSelected} />}
            {pipeline && <OptimizeView pipeline={pipeline} groupId={groupId} />}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
