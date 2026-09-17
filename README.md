# Pipeline Investigator

A Cribl Stream app for working with pipelines two ways. At the start you choose a mode:

- **Investigate** — step through a pipeline one function at a time to see exactly how your data transforms at each stage.
- **Optimize** — check a pipeline against Cribl performance and efficiency best practices, get a scored findings report, and preview a safe, behavior-preserving rewrite.

It runs as an app inside a Cribl Stream instance and talks to the Cribl API to preview a real pipeline against real (or pasted) sample events.

## Installation

Install directly from the Cribl Marketplace (Organization administrators only):

1. Log in to Cribl and click **Apps** in the top navigation.
2. Open the **Cribl Marketplace** catalog and find **Pipeline Investigator**.
3. Review the app's **Overview**, **Permissions**, and **External API Access**, then click **Install**.
4. Complete any pre-install checks Cribl prompts you with.

## Investigate mode

Step through a pipeline one function at a time to see exactly what each one does:

1. **Pick a pipeline** — a worker group, then a pipeline (group and installed-Pack pipelines are both listed).
2. **Provide sample events** — load a sample file from the group/Packs, or paste your own JSON/NDJSON.
3. **Step through the functions** — the app previews incrementally, so you see the event state after each individual function.
4. **See a field-level diff** — each step highlights fields **added**, **removed**, or **changed**, and tracks which events were **dropped**.
5. **Edit functions live** — tweak a function's config/filter and re-run; changes can optionally be saved back to the pipeline.

## Optimize mode

Review a pipeline against Cribl best practices without changing anything on your worker group:

1. **Pick a pipeline** — same selector as Investigate.
2. **Findings report** — a 0–100 efficiency score and a categorized, severity-ranked list of findings, each with a concrete recommendation. **Code** functions are statically inspected (never run) and, where the JS matches an idiom a built-in handles, the specific replacement is named.
3. **Recommended pipeline** — a safe, behavior-preserving rewrite (removes disabled functions, merges adjacent Evals, reorders volume-reducers only when provably safe), shown as a side-by-side diff. When a **Code** function matches known idioms it also generates a **draft** built-in replacement (Parser / Eval / Rename / Mask / Regex Extract), badged "generated, not proven equivalent" with per-rewrite notes. Drafts are never auto-applied — verify before use.
4. **Verify identical output** — run a sample through both the current and recommended pipelines and confirm they match field-for-field.
5. **Export** — download the pipeline as JSON. The id and filename are suffixed **`_new`** so importing it into Cribl won't overwrite the original.

### How the preview works

Cribl's preview endpoint requires a *saved* pipeline, so rather than touch your real one the app **clones it into a throwaway `pi_tmp_*` pipeline** (same group/Pack scope), previews against the clone, and **deletes it** in a `finally` block. The real pipeline is only ever read via `GET`; stray clones from an interrupted run are hidden and swept up on the next preview. See [src/api.ts](src/api.ts).

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

## Release Versions

| Version | Changes |
| --- | --- |
| 1.1.0 | Added **Optimize** mode: scored best-practice findings, a safe behavior-preserving rewrite with side-by-side diff, live field-for-field verification, and JSON export (suffixed `_new` so it won't overwrite the original). **Code** functions can generate a **draft** built-in replacement (Parser / Eval / Rename / Mask / Regex Extract), verified before use. |
| 1.0.0 | Initial release — **Investigate** mode: step through a pipeline function by function with a field-level before/after diff and dropped-event tracking, plus live function editing. |

## License

Licensed under the [Apache License 2.0](LICENSE).
