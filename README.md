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

Debugging a Cribl pipeline usually means squinting at the final output and guessing which function changed what. Investigate mode makes each transformation visible:

1. **Pick a pipeline** — choose a worker group, then a pipeline. Pipelines defined directly in the group *and* inside installed Packs are both listed.
2. **Provide sample events** — either load an existing sample file from the group/Packs, or paste your own JSON/NDJSON events.
3. **Step through the functions** — the app previews the pipeline incrementally, disabling every function after the current step, so you see the event state *after each individual function*. While a preview is running (e.g. after **Run All Steps**), a "please be patient — we're processing" banner appears at the top so it's clear larger pipelines or samples may take a moment.
4. **See a field-level diff** — for every step, `EventDiff` highlights which fields were **added**, **removed**, or **changed**, and tracks which input events were **dropped** along the way (via an injected `__pi_idx` tracking field).
5. **Edit functions live** — tweak a function's config/filter in-app and re-run the preview to see the effect. Changes can optionally be saved back to the pipeline.

## Optimize mode

Optimize mode reviews a pipeline against Cribl best practices without changing anything on your worker group:

1. **Pick a pipeline** — same selector as Investigate (group and Pack pipelines).
2. **Findings report** — 13 best-practice rules produce a 0–100 efficiency score and a categorized, severity-ranked list of findings (ordering, performance, maintainability, correctness), each with a concrete recommendation and the functions it affects. **Code functions** get special attention: the analyzer statically inspects the JavaScript body (it never runs it) and, when it recognizes an idiom a built-in handles — plain field add/remove, regex replace, JSON parse/serialize, timestamp parsing — it names the specific replacement (Eval, Mask, Parser, Auto Timestamp). Bodies with loops or helper functions that likely need Code are flagged more gently.
3. **Recommended pipeline** — a safe, behavior-preserving rewrite: it removes disabled functions, merges adjacent unfiltered Evals, and reorders volume-reducers ahead of expensive functions *only* when it can prove the move doesn't change results. A side-by-side diff shows what changed; anything it can't prove safe is listed separately for you to decide. When a **Code** function matches idioms a built-in handles (JSON parse, field add/remove, renames, regex replace/extract), the tab also generates a **draft** replacement — built-in functions spliced in place of the Code block, badged *generated* and clearly marked "not proven equivalent." Renames follow Cribl's own split: code that **replaces** a field (copies it to a new name and drops the original) becomes a **Rename** function, while code that **creates** a new field from an existing one stays an **Eval** — nested paths, which Rename can't flatten, also stay Eval and are noted. Drafts are best-effort (some Code can't be expressed with built-ins), list their assumptions as notes, and are never auto-applied — verify them (step 4) before use.
4. **Verify identical output** — run a sample file through both the current and recommended pipelines and confirm the output matches field-for-field. This uses the same temporary-clone preview mechanism as Investigate; your real pipeline is only read, never modified.
5. **Export** — download the optimized pipeline as JSON to review and import in Cribl. The exported pipeline's id (and filename) is suffixed with **`_new`** so importing it into Cribl creates a *separate* pipeline instead of overwriting the original. Optimize never writes to your real pipeline — it only creates and deletes a throwaway clone for the live verification preview; export is download-only.

### How the preview works

Cribl's preview endpoint ignores an inline `pipelineConf` when a `pipelineId` is given, so the config being previewed has to be a *saved* pipeline. Rather than modify your real pipeline, the app **clones it into a throwaway pipeline** (id prefixed `pi_tmp_`, in the same group/Pack scope), previews against the clone, and **deletes the clone** in a `finally` block. Investigate creates one clone and updates its function list per step (disabling later functions); Optimize previews the original by its real id (read-only) and clones only the optimized config. The real pipeline is only ever read via `GET`. Stray clones from an interrupted run are hidden from the picker and swept up on the next preview. Each sample event in Investigate is tagged with a tracking index so dropped events can be identified per step. See [src/api.ts](src/api.ts).

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
| 1.1 | Added **Optimize** mode: a scored best-practice findings report, a safe behavior-preserving rewrite with a side-by-side diff, live field-for-field verification, and JSON export. Preview clones the target pipeline into a throwaway `pi_tmp_*` pipeline instead of editing the real one. **Code** functions get special handling — the JS body is statically inspected and, where it matches common idioms, the **Recommended Pipeline** generates a **draft** built-in replacement (Parser / Eval / Rename / Mask / Regex Extract), badged "generated, not proven equivalent," with untranslatable parts noted. Renames follow Cribl's own model: a field that is **replaced** becomes a **Rename** function, a field **derived** from another stays an **Eval**, and nested paths (which Rename can't flatten) stay Eval and are noted. Exported pipelines are suffixed **`_new`** so importing won't overwrite the original. **Comment** functions are exempt from disabled-function cleanup — they document intent at no per-event cost. Investigate shows a "please be patient — we're processing" banner while a preview runs. Install via the Cribl Marketplace. |
| 1.0 | Initial release — **Investigate** mode: pick a pipeline (group or Pack), provide sample events, step through each function, and see a field-level before/after diff with dropped-event tracking. Live in-app function editing with optional save-back. |

## License

Licensed under the [Apache License 2.0](LICENSE).
