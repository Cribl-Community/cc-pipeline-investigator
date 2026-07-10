# Pipeline Investigator

A Cribl Stream app for **stepping through a pipeline one function at a time** to see exactly how your data transforms at each stage. It runs as an app inside a Cribl Stream instance and talks to the Cribl API to preview a real pipeline against real (or pasted) sample events.

## Installation

1. Log in to Cribl and then click on **Apps->View All**
2. Click **Add App->Import from Git**.
3. Paste the repo url and "latest" for the release tag.
4. Click **Import**.

## What it does

Debugging a Cribl pipeline usually means squinting at the final output and guessing which function changed what. Pipeline Investigator makes each transformation visible:

1. **Pick a pipeline** — choose a worker group, then a pipeline. Pipelines defined directly in the group *and* inside installed Packs are both listed.
2. **Provide sample events** — either load an existing sample file from the group/Packs, or paste your own JSON/NDJSON events.
3. **Step through the functions** — the app previews the pipeline incrementally, disabling every function after the current step, so you see the event state *after each individual function*.
4. **See a field-level diff** — for every step, `EventDiff` highlights which fields were **added**, **removed**, or **changed**, and tracks which input events were **dropped** along the way (via an injected `__pi_idx` tracking field).
5. **Edit functions live** — tweak a function's config/filter in-app and re-run the preview to see the effect. Changes can optionally be saved back to the pipeline.

### How the preview works

Because Cribl's preview endpoint ignores an inline `pipelineConf` when a `pipelineId` is given, the app temporarily **PATCHes** the pipeline with a modified function list (later functions disabled), runs `/preview`, then **restores** the original config in a `finally` block. Each sample event is tagged with a tracking index so dropped events can be identified per step. See [src/api.ts](src/api.ts).

## Project structure

- [src/App.tsx](src/App.tsx) — top-level flow: select pipeline → provide sample → step through
- [src/api.ts](src/api.ts) — all Cribl API calls (groups, pipelines, packs, samples, preview, save)
- [src/types.ts](src/types.ts) — Pipeline / function / event type definitions
- `src/components/`
  - `PipelineSelector.tsx` — worker group + pipeline picker (includes Pack pipelines)
  - `SampleInput.tsx` — load a sample file or paste events
  - `PipelineStepper.tsx` — the core stepper UI and preview orchestration
  - `FunctionConfig.tsx` — inline view/edit of a function's config
  - `EventDiff.tsx` — before/after field-level diff, hides internal `__*` fields by default

## Development

Clone this repo. Install dependencies and start the app.
```bash
npm install
npm run dev 
```

Log into Cribl Cloud
Go to App Platform > Development > Live Preview

## License

Licensed under the [Apache License 2.0](LICENSE).
