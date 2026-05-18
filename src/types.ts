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
  error?: string;
}
