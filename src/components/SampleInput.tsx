import { useState, useEffect } from 'react';
import type { CriblEvent, SampleFile } from '../types';
import { fetchSampleFiles, fetchSampleContent, uploadTempSample } from '../api';

export interface SampleSelection {
  sampleId: string;
  events: CriblEvent[];
}

interface Props {
  groupId: string;
  onSampleReady: (selection: SampleSelection) => void;
}

const PLACEHOLDER = `[
  {
    "_raw": "2024-01-15T10:30:00Z host=webserver01 action=login user=admin status=success",
    "source": "access.log",
    "sourcetype": "access_combined"
  }
]`;

export function SampleInput({ groupId, onSampleReady }: Props) {
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sampleFiles, setSampleFiles] = useState<SampleFile[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchSampleFiles(groupId)
      .then(files => {
        setSampleFiles(files);
        if (files.length > 0) setSelectedFile(files[0].id);
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [groupId]);

  const handleLoadFile = async () => {
    if (!selectedFile) return;
    setLoading(true);
    setError(null);
    try {
      const events = await fetchSampleContent(groupId, selectedFile);
      if (events.length === 0) {
        setError('Sample file returned no events');
        return;
      }
      onSampleReady({ sampleId: selectedFile, events });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleParse = async () => {
    setError(null);
    try {
      const parsed = JSON.parse(text);
      const events: CriblEvent[] = Array.isArray(parsed) ? parsed : [parsed];
      if (events.length === 0) {
        setError('Please provide at least one event');
        return;
      }
      setLoading(true);
      try {
        const sampleId = await uploadTempSample(groupId, events);
        onSampleReady({ sampleId, events });
      } catch {
        // If upload fails, still pass events — preview may support inline events in some versions
        onSampleReady({ sampleId: '', events });
      }
    } catch {
      setError('Invalid JSON. Paste a single event object or an array of events.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sample-input">
      <h3>Sample Data</h3>
      <div className="sample-mode-tabs">
        <button
          className={`tab ${mode === 'file' ? 'tab-active' : ''}`}
          onClick={() => setMode('file')}
        >
          Select from Environment
        </button>
        <button
          className={`tab ${mode === 'paste' ? 'tab-active' : ''}`}
          onClick={() => setMode('paste')}
        >
          Paste JSON
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}

      {mode === 'file' && (
        <div className="sample-file-picker">
          {sampleFiles.length === 0 && !loading && (
            <p className="sample-hint">No sample files found in this worker group.</p>
          )}
          {sampleFiles.length > 0 && (
            <>
              <p className="sample-hint">
                Select a sample file from your Cribl environment.
              </p>
              <div className="file-picker-row">
                <select
                  value={selectedFile}
                  onChange={e => setSelectedFile(e.target.value)}
                  disabled={loading}
                  className="file-select"
                >
                  {sampleFiles.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.id}{f.description ? ` — ${f.description}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-primary"
                  onClick={handleLoadFile}
                  disabled={loading || !selectedFile}
                >
                  {loading ? 'Loading...' : 'Load Sample'}
                </button>
              </div>
            </>
          )}
          {loading && <p className="sample-hint">Loading sample files...</p>}
        </div>
      )}

      {mode === 'paste' && (
        <div className="sample-paste">
          <p className="sample-hint">
            Paste a JSON event or array of events to process through the pipeline.
          </p>
          <textarea
            className="sample-textarea"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            rows={10}
          />
          <button className="btn btn-primary" onClick={handleParse} disabled={!text.trim() || loading}>
            {loading ? 'Uploading...' : 'Load Sample'}
          </button>
        </div>
      )}
    </div>
  );
}
