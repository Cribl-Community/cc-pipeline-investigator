import { useState } from 'react';
import type { PipelineFunction, Pipeline } from '../types';

interface Props {
  fn: PipelineFunction;
  pipeline: Pipeline;
  onUpdate: (updated: PipelineFunction) => void;
  onToggleDisable: () => void;
}

function ConfigValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="config-null">null</span>;
  }
  if (typeof value === 'boolean') {
    return <span className={`config-bool config-bool-${value}`}>{String(value)}</span>;
  }
  if (typeof value === 'number') {
    return <span className="config-number">{value}</span>;
  }
  if (typeof value === 'string') {
    if (value.includes('\n') || value.length > 80) {
      return <pre className="config-code">{value}</pre>;
    }
    return <span className="config-string">{value}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="config-null">[]</span>;
    return (
      <div className="config-array">
        {value.map((item, i) => (
          <div key={i} className="config-array-item">
            <ConfigValue value={item} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === 'object') {
    return (
      <div className="config-object">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="config-object-entry">
            <span className="config-object-key">{k}:</span>
            <ConfigValue value={v} />
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}

export function FunctionConfig({ fn, pipeline, onUpdate, onToggleDisable }: Props) {
  const [editingFilter, setEditingFilter] = useState(false);
  const [filterDraft, setFilterDraft] = useState(fn.filter ?? 'true');
  const [editingConf, setEditingConf] = useState(false);
  const [confDraft, setConfDraft] = useState(JSON.stringify(fn.conf, null, 2));
  const [confError, setConfError] = useState<string | null>(null);

  const groupInfo = fn.groupId && pipeline.conf.groups?.[fn.groupId];

  const handleFilterSave = () => {
    onUpdate({ ...fn, filter: filterDraft });
    setEditingFilter(false);
  };

  const handleConfSave = () => {
    setConfError(null);
    try {
      const parsed = JSON.parse(confDraft);
      onUpdate({ ...fn, conf: parsed });
      setEditingConf(false);
    } catch {
      setConfError('Invalid JSON');
    }
  };

  return (
    <div className={`function-config ${fn.disabled ? 'function-disabled' : ''}`}>
      <div className="config-section">
        <div className="config-section-header">
          <h4>Function Configuration</h4>
          <button
            className={`btn btn-sm ${fn.disabled ? 'btn-enable' : 'btn-disable'}`}
            onClick={onToggleDisable}
          >
            {fn.disabled ? 'Enable' : 'Disable'}
          </button>
        </div>
        {fn.disabled && (
          <div className="disabled-banner">This function is disabled and will be skipped during preview.</div>
        )}
        <table className="config-table">
          <tbody>
            <tr>
              <td className="config-label">Type</td>
              <td className="config-value"><code>{fn.id}</code></td>
            </tr>
            {fn.description && (
              <tr>
                <td className="config-label">Description</td>
                <td className="config-value">{fn.description}</td>
              </tr>
            )}
            <tr>
              <td className="config-label">Filter</td>
              <td className="config-value">
                {editingFilter ? (
                  <div className="inline-edit">
                    <input
                      type="text"
                      className="edit-input"
                      value={filterDraft}
                      onChange={e => setFilterDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleFilterSave(); if (e.key === 'Escape') setEditingFilter(false); }}
                      autoFocus
                    />
                    <button className="btn btn-sm btn-primary" onClick={handleFilterSave}>Save</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => setEditingFilter(false)}>Cancel</button>
                  </div>
                ) : (
                  <div className="editable-value" onClick={() => { setFilterDraft(fn.filter ?? 'true'); setEditingFilter(true); }}>
                    <code className="config-expr">{fn.filter || 'true'}</code>
                    <span className="edit-hint">click to edit</span>
                  </div>
                )}
              </td>
            </tr>
            {groupInfo && (
              <tr>
                <td className="config-label">Group</td>
                <td className="config-value">
                  <span className="config-group-badge">
                    {typeof groupInfo === 'object' ? groupInfo.name : fn.groupId}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {fn.conf && Object.keys(fn.conf).length > 0 && (
        <div className="config-section">
          <div className="config-section-header">
            <h4>Settings</h4>
            {!editingConf && (
              <button className="btn btn-sm btn-secondary" onClick={() => { setConfDraft(JSON.stringify(fn.conf, null, 2)); setEditingConf(true); }}>
                Edit
              </button>
            )}
          </div>
          {editingConf ? (
            <div className="conf-editor">
              <textarea
                className="conf-textarea"
                value={confDraft}
                onChange={e => setConfDraft(e.target.value)}
                rows={12}
              />
              {confError && <div className="error-text">{confError}</div>}
              <div className="conf-editor-actions">
                <button className="btn btn-sm btn-primary" onClick={handleConfSave}>Save</button>
                <button className="btn btn-sm btn-secondary" onClick={() => { setEditingConf(false); setConfError(null); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <table className="config-table">
              <tbody>
                {Object.entries(fn.conf).map(([key, value]) => (
                  <tr key={key}>
                    <td className="config-label">{key}</td>
                    <td className="config-value">
                      <ConfigValue value={value} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
