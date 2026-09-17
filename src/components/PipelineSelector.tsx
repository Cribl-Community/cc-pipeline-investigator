import { useState, useEffect, useCallback } from 'react';
import type { Pipeline, WorkerGroup } from '../types';
import { fetchWorkerGroups, fetchPipelines, fetchPipeline } from '../api';

interface Props {
  onPipelineSelected: (pipeline: Pipeline, groupId: string) => void;
}

export function PipelineSelector({ onPipelineSelected }: Props) {
  const [groups, setGroups] = useState<WorkerGroup[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedPipeline, setSelectedPipeline] = useState('');
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingPipelines, setLoadingPipelines] = useState(false);
  const [loadingSelect, setLoadingSelect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGroups = useCallback(() => {
    setLoadingGroups(true);
    setError(null);
    fetchWorkerGroups()
      .then(g => {
        setGroups(g);
        if (g.length > 0) setSelectedGroup(g[0].id);
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoadingGroups(false));
  }, []);

  useEffect(() => {
    // Fetch-on-mount. On the very first load inside Cribl Live Preview the API
    // base URL / auth may not be injected yet, so this can fail transiently;
    // the error state exposes a Retry button (loadGroups) to recover.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (!selectedGroup) return;
    // Refetch when the selected group changes; the setState calls reset the
    // dependent UI (loading flag + cleared lists) before the async fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingPipelines(true);
    setPipelines([]);
    setSelectedPipeline('');
    setError(null);
    fetchPipelines(selectedGroup)
      .then(p => {
        setPipelines(p);
        if (p.length > 0) setSelectedPipeline(p[0].id);
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoadingPipelines(false));
  }, [selectedGroup]);

  const handleSelect = async () => {
    if (!selectedGroup || !selectedPipeline) return;
    setLoadingSelect(true);
    setError(null);
    try {
      const pipeline = await fetchPipeline(selectedGroup, selectedPipeline);
      onPipelineSelected(pipeline, selectedGroup);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingSelect(false);
    }
  };

  return (
    <div className="pipeline-selector">
      <h3>Select Pipeline</h3>
      {error && (
        <div className="selector-error">
          <span className="error-text">{error}</span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={loadGroups}
            disabled={loadingGroups}
          >
            {loadingGroups ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}
      <div className="selector-row">
        <label>
          Worker Group
          <select
            value={selectedGroup}
            onChange={e => setSelectedGroup(e.target.value)}
            disabled={loadingGroups}
          >
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name || g.id}</option>
            ))}
          </select>
        </label>
        <label>
          Pipeline
          {loadingPipelines && <span className="loading-hint">Loading...</span>}
          <select
            value={selectedPipeline}
            onChange={e => setSelectedPipeline(e.target.value)}
            disabled={pipelines.length === 0}
          >
            {pipelines.map(p => (
              <option key={p.id} value={p.id}>
                {p._packId ? `[${p._packId}] ` : ''}{p.id.includes(':') ? p.id.split(':')[1] : p.id}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-primary"
          onClick={handleSelect}
          disabled={loadingSelect || !selectedPipeline}
        >
          {loadingSelect ? 'Loading...' : 'Load Pipeline'}
        </button>
      </div>
    </div>
  );
}
