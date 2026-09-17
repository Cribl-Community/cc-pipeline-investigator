export interface PipelineFunction {
  id: string;
  conf: Record<string, unknown>;
  filter?: string;
  final?: boolean;
  description?: string;
  disabled?: boolean;
  groupId?: string;
}

export interface Pipeline {
  id: string;
  _packId?: string;
  conf: {
    functions: PipelineFunction[];
    description?: string;
    asyncFuncTimeout?: number;
    output?: string;
    groups?: Record<string, { name: string; description?: string; disabled?: boolean }>;
  };
}

export interface WorkerGroup {
  id: string;
  name?: string;
  description?: string;
}

export interface Pack {
  id: string;
  displayName?: string;
  description?: string;
}

export interface CriblEvent {
  [key: string]: unknown;
}

export interface SampleFile {
  id: string;
  _packId?: string;
  sampleName?: string;
  description?: string;
  size?: number;
  count?: number;
  numEvents?: number;
  isTemplate?: boolean;
}

export interface StepResult {
  stepIndex: number;
  events: CriblEvent[];
  droppedEvents: CriblEvent[];
  originalIndices: number[];
  error?: string;
}

// --- Optimize mode ---

export type Severity = 'high' | 'medium' | 'low' | 'info';

export type Category = 'Ordering' | 'Performance' | 'Maintainability' | 'Correctness';

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  category: Category;
  detail: string; // what was found
  recommendation: string; // what to do about it
  // Functions this finding points at, for UI highlighting.
  functions: { index: number; label: string }[];
}

export interface AnalysisReport {
  pipelineId: string;
  score: number; // 0-100 efficiency score
  totalFunctions: number;
  enabledFunctions: number;
  findings: Finding[];
}
