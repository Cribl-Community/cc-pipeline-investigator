import { useState } from 'react';
import type { CriblEvent } from '../types';

interface Props {
  before: CriblEvent[];
  after: CriblEvent[];
  stepLabel: string;
}

type DiffLine = {
  key: string;
  type: 'added' | 'removed' | 'changed' | 'unchanged';
  beforeValue?: string;
  afterValue?: string;
};

const INTERNAL_FIELDS = new Set([
  '__cloneCount', '__criblEventType', '__ctrlFields', '__final',
  '__id', '__dropped', '__inputId', '__outputId', 'cribl_pipe',
]);

function filterEvent(event: CriblEvent, showInternal: boolean): CriblEvent {
  if (showInternal) return event;
  const filtered: CriblEvent = {};
  for (const [k, v] of Object.entries(event)) {
    if (!INTERNAL_FIELDS.has(k)) filtered[k] = v;
  }
  return filtered;
}

function computeDiff(before: CriblEvent, after: CriblEvent, showInternal: boolean): DiffLine[] {
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const lines: DiffLine[] = [];

  for (const key of Array.from(allKeys).sort()) {
    if (!showInternal && INTERNAL_FIELDS.has(key)) continue;
    const bVal = key in before ? JSON.stringify(before[key]) : undefined;
    const aVal = key in after ? JSON.stringify(after[key]) : undefined;

    if (bVal === undefined && aVal !== undefined) {
      lines.push({ key, type: 'added', afterValue: aVal });
    } else if (bVal !== undefined && aVal === undefined) {
      lines.push({ key, type: 'removed', beforeValue: bVal });
    } else if (bVal !== aVal) {
      lines.push({ key, type: 'changed', beforeValue: bVal, afterValue: aVal });
    } else {
      lines.push({ key, type: 'unchanged', beforeValue: bVal, afterValue: aVal });
    }
  }

  return lines;
}

export function EventDiff({ before, after, stepLabel }: Props) {
  const [selectedEvent, setSelectedEvent] = useState(0);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [showInternal, setShowInternal] = useState(false);
  const [viewMode, setViewMode] = useState<'diff' | 'raw'>('diff');

  const beforeEvent = before[selectedEvent] ?? {};
  const afterEvent = after[selectedEvent] ?? {};
  const diff = computeDiff(beforeEvent, afterEvent, showInternal);

  const changedCount = diff.filter(d => d.type !== 'unchanged').length;
  const visibleDiff = showUnchanged ? diff : diff.filter(d => d.type !== 'unchanged');

  return (
    <div className="event-diff">
      <div className="diff-header">
        <h3>{stepLabel}</h3>
        <div className="diff-controls">
          {after.length > 1 && (
            <select
              value={selectedEvent}
              onChange={e => setSelectedEvent(Number(e.target.value))}
              className="event-select"
            >
              {after.map((_, i) => (
                <option key={i} value={i}>Event {i + 1}</option>
              ))}
            </select>
          )}
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={e => setShowUnchanged(e.target.checked)}
            />
            Show unchanged
          </label>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={showInternal}
              onChange={e => setShowInternal(e.target.checked)}
            />
            Show internal fields
          </label>
          <div className="view-toggle">
            <button
              className={`btn btn-sm ${viewMode === 'diff' ? 'btn-active' : ''}`}
              onClick={() => setViewMode('diff')}
            >
              Diff
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'raw' ? 'btn-active' : ''}`}
              onClick={() => setViewMode('raw')}
            >
              Raw
            </button>
          </div>
        </div>
        <div className="diff-summary">
          {changedCount === 0 ? (
            <span className="no-changes">No changes in this step</span>
          ) : (
            <span>{changedCount} field{changedCount !== 1 ? 's' : ''} changed</span>
          )}
          {after.length !== before.length && (
            <span className="event-count-change">
              Events: {before.length} → {after.length}
            </span>
          )}
        </div>
      </div>

      {viewMode === 'diff' ? (
        <div className="diff-table">
          <div className="diff-row diff-row-header">
            <span className="diff-cell diff-key">Field</span>
            <span className="diff-cell diff-before">Before</span>
            <span className="diff-cell diff-after">After</span>
          </div>
          {visibleDiff.length === 0 && (
            <div className="diff-empty">No changes to display</div>
          )}
          {visibleDiff.map(line => (
            <div key={line.key} className={`diff-row diff-row-${line.type}`}>
              <span className="diff-cell diff-key">{line.key}</span>
              <span className="diff-cell diff-before">
                {line.type === 'added' ? '' : line.beforeValue}
              </span>
              <span className="diff-cell diff-after">
                {line.type === 'removed' ? '' : line.afterValue}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="raw-view">
          <div className="raw-panel">
            <h4>Before</h4>
            <pre>{JSON.stringify(filterEvent(beforeEvent, showInternal), null, 2)}</pre>
          </div>
          <div className="raw-panel">
            <h4>After</h4>
            <pre>{JSON.stringify(filterEvent(afterEvent, showInternal), null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
