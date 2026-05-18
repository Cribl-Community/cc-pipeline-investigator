import type { Pipeline, WorkerGroup, CriblEvent, PipelineFunction, SampleFile, Pack } from './types';

declare global {
  interface Window {
    CRIBL_API_URL?: string;
  }
}

function getApiUrl(): string {
  return window.CRIBL_API_URL || '/api/v1';
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, init);
  if (!res.ok) {
    return { ok: false, status: res.status, data: null };
  }
  const contentType = res.headers.get('content-type') ?? '';
  // Reject only HTML responses (Vite SPA fallback). Allow JSON, NDJSON, text, etc.
  if (contentType.includes('text/html')) {
    return { ok: false, status: res.status, data: null };
  }
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    return { ok: true, status: res.status, data };
  } catch {
    // Try NDJSON (newline-delimited JSON)
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      try {
        const items = lines.map(l => JSON.parse(l));
        return { ok: true, status: res.status, data: { items } };
      } catch {
        return { ok: false, status: res.status, data: null };
      }
    }
    return { ok: false, status: res.status, data: null };
  }
}

export async function fetchWorkerGroups(): Promise<WorkerGroup[]> {
  const { ok, data } = await fetchJson(`${getApiUrl()}/master/groups`);
  if (!ok || !data) throw new Error('Failed to fetch worker groups');
  const d = data as { items?: WorkerGroup[] };
  return d.items ?? (data as WorkerGroup[]);
}

export async function fetchPacks(groupId: string): Promise<Pack[]> {
  const { ok, data } = await fetchJson(`${getApiUrl()}/m/${groupId}/packs`);
  if (!ok || !data) return [];
  const d = data as { items?: Pack[] };
  return d.items ?? (data as Pack[]);
}

export async function fetchPipelines(groupId: string): Promise<Pipeline[]> {
  const allPipelines: Pipeline[] = [];

  const { ok, data } = await fetchJson(`${getApiUrl()}/m/${groupId}/pipelines`);
  if (ok && data) {
    const d = data as { items?: Pipeline[] };
    const items = d.items ?? (data as Pipeline[]);
    if (Array.isArray(items)) {
      allPipelines.push(...items.filter((p: Pipeline) => p.conf?.functions));
    }
  }

  const packs = await fetchPacks(groupId);
  for (const pack of packs) {
    const packRes = await fetchJson(`${getApiUrl()}/m/${groupId}/p/${pack.id}/pipelines`);
    if (packRes.ok && packRes.data) {
      const d = packRes.data as { items?: Pipeline[] };
      const packItems = d.items ?? (packRes.data as Pipeline[]);
      if (Array.isArray(packItems)) {
        for (const p of packItems) {
          allPipelines.push({ ...p, id: `${pack.id}:${p.id}`, _packId: pack.id });
        }
      }
    }
  }

  return allPipelines;
}

export async function fetchPipeline(groupId: string, pipelineId: string): Promise<Pipeline> {
  const colonIdx = pipelineId.indexOf(':');
  let url: string;
  if (colonIdx > 0) {
    const packId = pipelineId.substring(0, colonIdx);
    const pipeId = pipelineId.substring(colonIdx + 1);
    url = `${getApiUrl()}/m/${groupId}/p/${packId}/pipelines/${pipeId}`;
  } else {
    url = `${getApiUrl()}/m/${groupId}/pipelines/${pipelineId}`;
  }

  const { ok, data } = await fetchJson(url);
  if (!ok || !data) throw new Error(`Failed to fetch pipeline: ${pipelineId}`);
  const d = data as { items?: Pipeline[] };
  const pipeline = d.items?.[0] ?? (data as Pipeline);
  pipeline.id = pipelineId;
  return pipeline;
}

export async function fetchSampleFiles(groupId: string): Promise<SampleFile[]> {
  const allSamples: SampleFile[] = [];

  const { ok, data } = await fetchJson(`${getApiUrl()}/m/${groupId}/system/samples`);
  if (ok && data) {
    const d = data as { items?: SampleFile[] };
    const items = d.items ?? (Array.isArray(data) ? data as SampleFile[] : []);
    allSamples.push(...items.filter(s => !s.isTemplate));
  }

  const packs = await fetchPacks(groupId);
  for (const pack of packs) {
    const packRes = await fetchJson(`${getApiUrl()}/m/${groupId}/p/${pack.id}/system/samples`);
    if (packRes.ok && packRes.data) {
      const d = packRes.data as { items?: SampleFile[] };
      const items = d.items ?? (Array.isArray(packRes.data) ? packRes.data as SampleFile[] : []);
      for (const s of items.filter(s => !s.isTemplate)) {
        allSamples.push({ ...s, id: `${pack.id}:${s.id}`, _packId: pack.id });
      }
    }
  }

  if (allSamples.length === 0) {
    throw new Error('No sample files found in this worker group or its packs.');
  }

  return allSamples;
}

export async function fetchSampleContent(groupId: string, sampleId: string): Promise<CriblEvent[]> {
  const colonIdx = sampleId.indexOf(':');
  let url: string;

  if (colonIdx > 0) {
    const packId = sampleId.substring(0, colonIdx);
    const fileId = sampleId.substring(colonIdx + 1);
    url = `${getApiUrl()}/m/${groupId}/p/${packId}/system/samples/${encodeURIComponent(fileId)}/content`;
  } else {
    url = `${getApiUrl()}/m/${groupId}/system/samples/${encodeURIComponent(sampleId)}/content`;
  }

  const { ok, data } = await fetchJson(url);
  if (ok && data) {
    const items = Array.isArray(data) ? data : (data as { items?: unknown[] }).items ?? [];
    if (Array.isArray(items) && items.length > 0) {
      if (typeof items[0] === 'string') {
        return items.map((line: string) => {
          try { return JSON.parse(line); } catch { return { _raw: line }; }
        });
      }
      return items as CriblEvent[];
    }
  }

  throw new Error(`Failed to fetch sample content for "${sampleId}"`);
}

export async function uploadTempSample(groupId: string, events: CriblEvent[]): Promise<string> {
  const sampleId = `__pipeline_stepper_temp_${Date.now()}`;
  const ndjson = events.map(e => JSON.stringify(e)).join('\n');

  const endpoints = [
    `${getApiUrl()}/m/${groupId}/system/samples/${sampleId}`,
    `${getApiUrl()}/system/samples/${sampleId}`,
    `${getApiUrl()}/m/${groupId}/system/datagen/${sampleId}`,
    `${getApiUrl()}/system/datagen/${sampleId}`,
    `${getApiUrl()}/m/${groupId}/samples/${sampleId}`,
    `${getApiUrl()}/m/${groupId}/lib/datagen/${sampleId}`,
  ];

  // Try PUT with JSON body
  for (const url of endpoints) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sampleId, content: ndjson }),
    });
    if (res.ok) return sampleId;
  }

  throw new Error('Failed to upload temporary sample. Select a sample from your environment instead.');
}

export async function deleteTempSample(groupId: string, sampleId: string): Promise<void> {
  if (!sampleId.startsWith('__pipeline_stepper_temp_')) return;
  const endpoints = [
    `${getApiUrl()}/m/${groupId}/samples/${sampleId}`,
    `${getApiUrl()}/m/${groupId}/lib/datagen/${sampleId}`,
  ];
  for (const url of endpoints) {
    await fetch(url, { method: 'DELETE' }).catch(() => {});
  }
}

export async function savePipeline(
  groupId: string,
  pipelineId: string,
  functions: PipelineFunction[]
): Promise<void> {
  const colonIdx = pipelineId.indexOf(':');
  const packId = colonIdx > 0 ? pipelineId.substring(0, colonIdx) : null;
  const actualPipelineId = colonIdx > 0 ? pipelineId.substring(colonIdx + 1) : pipelineId;

  const url = packId
    ? `${getApiUrl()}/m/${groupId}/p/${packId}/pipelines/${actualPipelineId}`
    : `${getApiUrl()}/m/${groupId}/pipelines/${actualPipelineId}`;

  const { ok, data } = await fetchJson(url);
  if (!ok || !data) throw new Error(`Failed to fetch existing pipeline config for save`);

  const existing = (data as { items?: Pipeline[] }).items?.[0] ?? (data as Pipeline);
  const updated = { ...existing, conf: { ...existing.conf, functions } };

  const saveRes = await fetchJson(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updated),
  });

  if (!saveRes.ok) throw new Error('Failed to save pipeline');
}

export interface PreviewResult {
  events: CriblEvent[];
  droppedEvents: CriblEvent[];
}

async function runPreview(
  previewUrl: string,
  actualPipelineId: string,
  sampleId: string,
  sampleEvents: CriblEvent[],
): Promise<CriblEvent[]> {
  const body: Record<string, unknown> = {
    cpuProfile: false,
    dropped: false,
    mode: "pipe",
    pipelineId: actualPipelineId,
    sampleId: sampleId || undefined,
    level: 3,
    timeout: 10000,
    memory: 2048,
  };
  if (!sampleId) {
    body.events = sampleEvents;
  }

  const res = await fetch(previewUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`Preview failed (${res.status}): ${responseText.substring(0, 200)}`);
  }

  let allItems: CriblEvent[] = [];
  try {
    const data = JSON.parse(responseText);
    if (Array.isArray(data)) {
      allItems = data;
    } else {
      allItems = data.items ?? data.events ?? [];
    }
  } catch {
    const lines = responseText.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try { allItems.push(JSON.parse(line)); } catch { /* skip */ }
    }
  }

  if (allItems.length === 0) {
    throw new Error(`Preview returned no parseable events. Raw response: ${responseText.substring(0, 300)}`);
  }

  return allItems;
}

export async function previewPipeline(
  groupId: string,
  pipelineId: string,
  sampleId: string,
  sampleEvents: CriblEvent[],
  allFunctions: PipelineFunction[],
  finalStepIndex: number
): Promise<PreviewResult> {
  const results = await previewPipelineBatch(groupId, pipelineId, sampleId, sampleEvents, allFunctions, [finalStepIndex]);
  return results[0];
}

export async function previewPipelineBatch(
  groupId: string,
  pipelineId: string,
  sampleId: string,
  sampleEvents: CriblEvent[],
  allFunctions: PipelineFunction[],
  stepIndices: number[]
): Promise<PreviewResult[]> {
  const colonIdx = pipelineId.indexOf(':');
  const packId = colonIdx > 0 ? pipelineId.substring(0, colonIdx) : null;
  const actualPipelineId = colonIdx > 0 ? pipelineId.substring(colonIdx + 1) : pipelineId;

  const pipelineUrl = packId
    ? `${getApiUrl()}/m/${groupId}/p/${packId}/pipelines/${actualPipelineId}`
    : `${getApiUrl()}/m/${groupId}/pipelines/${actualPipelineId}`;
  const previewUrl = packId
    ? `${getApiUrl()}/m/${groupId}/p/${packId}/preview`
    : `${getApiUrl()}/m/${groupId}/preview`;

  const { ok: fetchOk, data: fetchData } = await fetchJson(pipelineUrl);
  if (!fetchOk || !fetchData) throw new Error('Failed to fetch pipeline for preview');
  const existing = (fetchData as { items?: Pipeline[] }).items?.[0] ?? (fetchData as Pipeline);

  const results: PreviewResult[] = [];

  try {
    for (const finalStepIndex of stepIndices) {
      const modifiedFunctions = allFunctions.map((fn, idx) => ({
        ...fn,
        disabled: idx <= finalStepIndex ? fn.disabled : true,
      }));

      const tempPipeline = { ...existing, conf: { ...existing.conf, functions: modifiedFunctions } };
      const patchRes = await fetchJson(pipelineUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tempPipeline),
      });
      if (!patchRes.ok) throw new Error('Failed to save temporary pipeline config');

      const events = await runPreview(previewUrl, actualPipelineId, sampleId, sampleEvents);
      results.push({ events, droppedEvents: [] });
    }
  } finally {
    const restorePipeline = { ...existing, conf: { ...existing.conf, functions: allFunctions } };
    await fetchJson(pipelineUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(restorePipeline),
    });
  }

  return results;
}
