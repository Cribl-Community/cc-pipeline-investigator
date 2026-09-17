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

// Preview runs against throwaway clones of the target pipeline so the real
// pipeline is never modified. Clones are named with this prefix so they can be
// hidden from the picker and swept up if a previous run left one behind.
export const TEMP_PIPELINE_PREFIX = 'pi_tmp_';

// Delay (ms) after a config write before previewing, so the leader has
// registered the new/updated pipeline config.
const SETTLE_MS = 250;

function splitPackId(pipelineId: string): { packId: string | null; actualId: string } {
  const i = pipelineId.indexOf(':');
  return i > 0
    ? { packId: pipelineId.substring(0, i), actualId: pipelineId.substring(i + 1) }
    : { packId: null, actualId: pipelineId };
}

function pipelineCollectionUrl(groupId: string, packId: string | null): string {
  return packId
    ? `${getApiUrl()}/m/${groupId}/p/${packId}/pipelines`
    : `${getApiUrl()}/m/${groupId}/pipelines`;
}

function pipelineItemUrl(groupId: string, packId: string | null, id: string): string {
  return `${pipelineCollectionUrl(groupId, packId)}/${id}`;
}

function newTempPipelineId(): string {
  return `${TEMP_PIPELINE_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Clone `template` into a new throwaway pipeline (same group/pack scope) whose
 * function list is `functions`. Returns the temp pipeline's id. The real
 * pipeline is only read, never written.
 */
async function createTempPipeline(
  groupId: string,
  packId: string | null,
  template: Pipeline,
  functions: PipelineFunction[]
): Promise<string> {
  const tempId = newTempPipelineId();
  const body = { ...template, id: tempId, _packId: undefined, conf: { ...template.conf, functions } };
  const res = await fetchJson(pipelineCollectionUrl(groupId, packId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to create temporary pipeline for preview');
  return tempId;
}

/** Replace the function list on an existing temp clone (used per step in Investigate). */
async function patchTempPipeline(
  groupId: string,
  packId: string | null,
  tempId: string,
  template: Pipeline,
  functions: PipelineFunction[]
): Promise<void> {
  const body = { ...template, id: tempId, _packId: undefined, conf: { ...template.conf, functions } };
  const res = await fetchJson(pipelineItemUrl(groupId, packId, tempId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to update temporary pipeline for preview');
}

/** Best-effort delete of a temp clone. Never throws. */
async function deleteTempPipeline(groupId: string, packId: string | null, tempId: string): Promise<void> {
  if (!tempId.startsWith(TEMP_PIPELINE_PREFIX)) return; // guard: never delete a real pipeline
  await fetchJson(pipelineItemUrl(groupId, packId, tempId), { method: 'DELETE' }).catch(() => {});
}

/** Best-effort sweep of any temp clones left behind by a crashed previous run. */
async function cleanupTempPipelines(groupId: string, packId: string | null): Promise<void> {
  try {
    const { ok, data } = await fetchJson(pipelineCollectionUrl(groupId, packId));
    if (!ok || !data) return;
    const items = (data as { items?: Pipeline[] }).items ?? (Array.isArray(data) ? (data as Pipeline[]) : []);
    for (const p of items) {
      if (typeof p.id === 'string' && p.id.startsWith(TEMP_PIPELINE_PREFIX)) {
        await deleteTempPipeline(groupId, packId, p.id);
      }
    }
  } catch {
    /* best effort */
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
      allPipelines.push(
        ...items.filter((p: Pipeline) => p.conf?.functions && !p.id.startsWith(TEMP_PIPELINE_PREFIX))
      );
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
          if (p.id.startsWith(TEMP_PIPELINE_PREFIX)) continue;
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
  const sampleId = `__pipeline_investigator_temp_${Date.now()}`;
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
  if (!sampleId.startsWith('__pipeline_investigator_temp_')) return;
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

export const TRACKING_FIELD = '__pi_idx';

export interface PreviewResult {
  events: CriblEvent[];
  droppedEvents: CriblEvent[];
  originalIndices: number[];
}

function parsePreviewResponse(responseText: string): CriblEvent[] {
  try {
    const data = JSON.parse(responseText);
    if (Array.isArray(data)) return data;
    return data.items ?? data.events ?? [];
  } catch {
    const lines = responseText.split('\n').filter(l => l.trim());
    const items: CriblEvent[] = [];
    for (const line of lines) {
      try { items.push(JSON.parse(line)); } catch { /* skip */ }
    }
    return items;
  }
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
  _sampleId: string,
  sampleEvents: CriblEvent[],
  allFunctions: PipelineFunction[],
  stepIndices: number[]
): Promise<PreviewResult[]> {
  const { packId, actualId } = splitPackId(pipelineId);
  const pipelineUrl = pipelineItemUrl(groupId, packId, actualId);
  // Pack pipelines preview through the pack-scoped endpoint; group pipelines
  // through the group endpoint. Either way the id we reference is the temp clone.
  const previewUrl = packId
    ? `${getApiUrl()}/m/${groupId}/p/${packId}/preview`
    : `${getApiUrl()}/m/${groupId}/preview`;

  const { ok: fetchOk, data: fetchData } = await fetchJson(pipelineUrl);
  if (!fetchOk || !fetchData) throw new Error('Failed to fetch pipeline for preview');
  const template = (fetchData as { items?: Pipeline[] }).items?.[0] ?? (fetchData as Pipeline);

  // Tag each event with its original index so we can track drops through the pipeline.
  // Always use inline events so we control the tracking field.
  const taggedEvents = sampleEvents.map((e, i) => ({ ...e, [TRACKING_FIELD]: i }));

  // Clone the target pipeline into a throwaway. The real pipeline is never written:
  // we PATCH the clone per step and delete it in `finally`.
  await cleanupTempPipelines(groupId, packId);
  const tempId = await createTempPipeline(groupId, packId, template, allFunctions);

  const results: PreviewResult[] = [];

  try {
    for (const finalStepIndex of stepIndices) {
      const modifiedFunctions = allFunctions.map((fn, idx) => ({
        ...fn,
        disabled: idx <= finalStepIndex ? fn.disabled : true,
      }));

      await patchTempPipeline(groupId, packId, tempId, template, modifiedFunctions);
      await new Promise(r => setTimeout(r, SETTLE_MS));

      const body = {
        cpuProfile: false, dropped: false, mode: "pipe",
        pipelineId: tempId,
        level: 3, timeout: 10000, memory: 2048,
        events: taggedEvents,
      };

      const res = await fetch(previewUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseText = await res.text();
      if (!res.ok) {
        throw new Error(`Preview failed (${res.status}): ${responseText.substring(0, 200)}`);
      }
      const events = parsePreviewResponse(responseText);
      const originalIndices = events.map(e => {
        const idx = e[TRACKING_FIELD];
        return typeof idx === 'number' ? idx : -1;
      });
      results.push({ events, droppedEvents: [], originalIndices });
    }
  } finally {
    await deleteTempPipeline(groupId, packId, tempId);
  }

  return results;
}

// --- Optimize mode: original-vs-optimized comparison ---------------------

export interface PreviewComparison {
  originalOut: CriblEvent[];
  optimizedOut: CriblEvent[];
  cloned: boolean; // whether a throwaway clone was created for the optimized run
}

/**
 * Run the same events through the saved pipeline and through a candidate
 * (optimized) function list, returning both outputs for equivalence checking.
 *
 * Neither run modifies the target pipeline:
 *  - the original is previewed by its saved `pipelineId` (read-only);
 *  - the optimized config is cloned into a throwaway pipeline that is previewed
 *    and then deleted in a `finally`.
 * This is required because Cribl's preview ignores an inline `pipelineConf`
 * when a `pipelineId` is set — the config to preview must be a saved pipeline.
 *
 * Events are NOT tagged with `__pi_idx` here — equivalence compares field
 * values directly, and both runs see identical input.
 */
export async function previewOriginalAndOptimized(
  groupId: string,
  pipelineId: string,
  events: CriblEvent[],
  optimizedFunctions: PipelineFunction[]
): Promise<PreviewComparison> {
  const { packId, actualId } = splitPackId(pipelineId);
  const pipelineUrl = pipelineItemUrl(groupId, packId, actualId);
  // Preview is always group-level — no `/p/:pack` segment. A pack pipeline is
  // identified to the group preview by its namespaced id.
  const previewUrl = `${getApiUrl()}/m/${groupId}/preview`;

  const runPreview = async (previewPipelineId: string): Promise<CriblEvent[]> => {
    const body = {
      cpuProfile: false, dropped: false, mode: 'pipe',
      pipelineId: previewPipelineId,
      level: 3, timeout: 10000, memory: 2048,
      events,
    };
    const res = await fetch(previewUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const responseText = await res.text();
    if (!res.ok) {
      throw new Error(`Preview failed (${res.status}): ${responseText.substring(0, 200)}`);
    }
    return parsePreviewResponse(responseText);
  };

  // Read the saved pipeline (read-only) — used both as the original and as the
  // clone template.
  const { ok, data } = await fetchJson(pipelineUrl);
  if (!ok || !data) throw new Error('Failed to fetch pipeline for preview');
  const template = (data as { items?: Pipeline[] }).items?.[0] ?? (data as Pipeline);

  // 1. Original: preview the saved pipeline by id — no mutation.
  const originalOut = await runPreview(packId ? `${packId}:${actualId}` : actualId);

  // 2. Optimized: clone into a throwaway pipeline, preview it, then delete it.
  await cleanupTempPipelines(groupId, packId);
  const tempId = await createTempPipeline(groupId, packId, template, optimizedFunctions);
  try {
    await new Promise(r => setTimeout(r, SETTLE_MS));
    const optimizedOut = await runPreview(packId ? `${packId}:${tempId}` : tempId);
    return { originalOut, optimizedOut, cloned: true };
  } finally {
    await deleteTempPipeline(groupId, packId, tempId);
  }
}
