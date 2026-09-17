export type Mode = 'investigate' | 'optimize';

interface Props {
  onSelect: (mode: Mode) => void;
}

export function ModeSelector({ onSelect }: Props) {
  return (
    <div className="mode-selector">
      <div className="mode-selector-intro">
        <h2>What would you like to do?</h2>
        <p>Choose how to work with a pipeline. You can switch modes at any time.</p>
      </div>

      <div className="mode-cards">
        <button className="mode-card" onClick={() => onSelect('investigate')}>
          <span className="mode-card-icon" aria-hidden="true">🔍</span>
          <span className="mode-card-title">Investigate</span>
          <span className="mode-card-desc">
            Step through a pipeline one function at a time and see exactly how your data
            transforms — with a field-level diff at every stage.
          </span>
          <span className="mode-card-cta">Step through &rarr;</span>
        </button>

        <button className="mode-card" onClick={() => onSelect('optimize')}>
          <span className="mode-card-icon" aria-hidden="true">⚡</span>
          <span className="mode-card-title">Optimize</span>
          <span className="mode-card-desc">
            Check a pipeline against Cribl performance and efficiency best practices, get a
            scored findings report, and preview a safe behavior-preserving rewrite.
          </span>
          <span className="mode-card-cta">Run a check &rarr;</span>
        </button>
      </div>
    </div>
  );
}
