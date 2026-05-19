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

interface MatchedEvent {
  originalIndex: number;
  beforeEvent: CriblEvent;
  afterEvent: CriblEvent | null;
}

function matchEvents(before: CriblEvent[], after: CriblEvent[]): MatchedEvent[] {
  const matched: MatchedEvent[] = [];
  const usedAfter = new Set<number>();

  for (let bi = 0; bi < before.length; bi++) {
    const bRaw = before[bi]._raw;
    let bestMatch = -1;

    if (bRaw !== undefined) {
      for (let ai = 0; ai < after.length; ai++) {
        if (usedAfter.has(ai)) continue;
        if (after[ai]._raw === bRaw) {
          bestMatch = ai;
          break;
        }
      }
    }

    if (bestMatch === -1) {
      for (let ai = 0; ai < after.length; ai++) {
        if (usedAfter.has(ai)) continue;
        if (JSON.stringify(before[bi]) === JSON.stringify(after[ai]) ||
            (bRaw !== undefined && after[ai]._raw === bRaw)) {
          bestMatch = ai;
          break;
        }
      }
    }

    // Fallback: match by position if no identity match found and index is still available
    if (bestMatch === -1 && bi < after.length && !usedAfter.has(bi)) {
      bestMatch = bi;
    }

    if (bestMatch >= 0) {
      usedAfter.add(bestMatch);
      matched.push({ originalIndex: bi, beforeEvent: before[bi], afterEvent: after[bestMatch] });
    } else {
      matched.push({ originalIndex: bi, beforeEvent: before[bi], afterEvent: null });
    }
  }

  return matched;
}

export function EventDiff({ before, after, stepLabel }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [showInternal, setShowInternal] = useState(false);
  const [viewMode, setViewMode] = useState<'diff' | 'raw'>('diff');
  const [showDropped, setShowDropped] = useState(false);

  const matched = matchEvents(before, after);
  const survivingEvents = matched.filter(m => m.afterEvent !== null);
  const droppedEvents = matched.filter(m => m.afterEvent === null);
  const displayEvents = showDropped ? matched : survivingEvents;

  const selected = displayEvents[selectedIdx] ?? displayEvents[0];
  const beforeEvent = selected?.beforeEvent ?? {};
  const afterEvent = selected?.afterEvent ?? {};
  const isDropped = selected?.afterEvent === null;

  const diff = isDropped
    ? Object.keys(beforeEvent).filter(k => showInternal || !INTERNAL_FIELDS.has(k)).sort().map(key => ({
        key, type: 'removed' as const, beforeValue: JSON.stringify(beforeEvent[key]), afterValue: undefined,
      }))
    : computeDiff(beforeEvent, afterEvent, showInternal);

  const changedCount = diff.filter(d => d.type !== 'unchanged').length;
  const visibleDiff = showUnchanged ? diff : diff.filter(d => d.type !== 'unchanged');

  return (
    <div className="event-diff">
      <div className="diff-header">
        <h3>{stepLabel}</h3>
        <div className="diff-controls">
          {displayEvents.length > 1 && (
            <select
              value={selectedIdx}
              onChange={e => setSelectedIdx(Number(e.target.value))}
              className="event-select"
            >
              {displayEvents.map((m, i) => (
                <option key={i} value={i}>
                  Event {m.originalIndex + 1}{m.afterEvent === null ? ' (dropped)' : ''}
                </option>
              ))}
            </select>
          )}
          {droppedEvents.length > 0 && (
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={showDropped}
                onChange={e => { setShowDropped(e.target.checked); setSelectedIdx(0); }}
              />
              Show dropped ({droppedEvents.length})
            </label>
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
          {isDropped ? (
            <span className="status-dropped">Event {selected.originalIndex + 1} was dropped</span>
          ) : changedCount === 0 ? (
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
            <h4>{isDropped ? 'After (dropped)' : 'After'}</h4>
            <pre>{isDropped ? '— event dropped —' : JSON.stringify(filterEvent(afterEvent, showInternal), null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
