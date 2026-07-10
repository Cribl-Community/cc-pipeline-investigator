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

```bash
npm install
npm run dev        # Vite dev server with HMR
npm run lint       # ESLint
npm run build      # tsc -b && vite build → dist/
```

The app expects the Cribl API at `/api/v1` by default. Override it by setting `window.CRIBL_API_URL` (see [src/api.ts](src/api.ts)).

## Releasing

Releases are cut from Git tags via GitHub Actions ([.github/workflows/release.yml](.github/workflows/release.yml)). Pushing a tag matching `v*` runs `npm ci`, lints, packages the app at the tag's version (the leading `v` is stripped, so `v1.0.0` → `1.0.0`), materializes the Cribl pack layout (`static/` + `default/`) onto the tag, moves a rolling `latest` tag, and publishes a GitHub Release with the built `.tgz` attached.

You do **not** need to bump the version in `package.json` — the workflow stamps it from the tag name at build time.

Cut a release from a clean `main`:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Then watch the run or open the release page:

```bash
gh run watch
gh release view v1.0.0 --web
```

Sanity-check locally before tagging (discard any local `package.json` version bump afterward — only the tagged commit matters to CI):

```bash
npm ci && npm run lint && npm run package -- --version 1.0.0
ls build/*.tgz
```

To retag, delete the bad tag locally and on the remote first:

```bash
git tag -d v1.0.0
git push origin :refs/tags/v1.0.0
```

### Packaging locally

To build a `.tgz` bundle without cutting a release:

```bash
npm run package                 # build + patch version bump → build/<name>-<version>.tgz
npm run package -- --minor      # 1.0.7 → 1.1.0
npm run package -- --major      # 1.0.7 → 2.0.0
npm run package -- --version 1.2.3
```

This runs `npm run build`, bumps the version in `package.json`, and writes the tarball to `build/cc-pipeline-investigation-<version>.tgz`. See [scripts/package.mjs](scripts/package.mjs).

## Tech stack

React 19 + TypeScript, built with Vite. Packaged as a Cribl Stream app (`cribl.type: "app"` in [package.json](package.json)).

## License

Licensed under the [Apache License 2.0](LICENSE).
