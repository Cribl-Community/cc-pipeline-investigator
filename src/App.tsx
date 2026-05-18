import { useState } from 'react';
import type { Pipeline, CriblEvent } from './types';
import { PipelineSelector } from './components/PipelineSelector';
import { SampleInput, type SampleSelection } from './components/SampleInput';
import { PipelineStepper } from './components/PipelineStepper';

function App() {
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

  const handleReset = () => {
    setPipeline(null);
    setGroupId('');
    setSampleId('');
    setSampleEvents([]);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Pipeline Stepper</h1>
        {pipeline && (
          <button className="btn btn-secondary" onClick={handleReset}>
            Change Pipeline
          </button>
        )}
      </header>

      <main className="app-main">
        {!pipeline && (
          <PipelineSelector onPipelineSelected={handlePipelineSelected} />
        )}

        {pipeline && sampleEvents.length === 0 && (
          <SampleInput groupId={groupId} onSampleReady={handleSampleReady} />
        )}

        {pipeline && sampleEvents.length > 0 && (
          <PipelineStepper
            pipeline={pipeline}
            groupId={groupId}
            sampleId={sampleId}
            sampleEvents={sampleEvents}
            onSampleChange={handleSampleReady}
          />
        )}
      </main>
    </div>
  );
}

export default App;
