import type { PipelineFunction } from './types';

// Best-effort translation of a Cribl **Code** function's JavaScript body into the
// equivalent built-in functions (Parser, Eval, Mask, Regex Extract). This is a
// heuristic transpiler — it never executes the code, and it cannot *prove* the
// result is equivalent, so its output is always a **draft** the user verifies via
// the live preview before use. It recognises the common idioms the Findings-tab
// inspector flags and emits the matching functions, in source order.

export interface CodeRewrite {
  // Generated built-in functions, ordered by where their idiom appears in the
  // original code so the sequence of operations is preserved.
  functions: PipelineFunction[];
  // Assumptions made and anything that could not be translated. Any note means
  // the draft needs manual review (see `fullyTranslated`).
  notes: string[];
  fullyTranslated: boolean;
}

interface Emitted {
  at: number;
  fn: PipelineFunction;
}

// Strip block/line comments so keywords inside them don't trip the heuristics.
// Kept in sync with inspectCode() in rules.ts.
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

// A meaningful filter is inherited by every generated function; a "run on
// everything" filter ('true'/empty) is dropped so we don't add noise.
function inheritFilter(filter?: string): string | undefined {
  const f = filter?.trim();
  return f && f !== 'true' ? f : undefined;
}

// If an Eval `value` is a bare reference to a single event field
// (`__e.old`, `event.old`, `__e['old']`), return that field name; otherwise null.
// A computed expression (`Date.parse(__e.published)/1000`) or a nested accessor
// (`__e.actor.id`) is not a bare reference and returns null.
function pureFieldRef(value: string): string | null {
  const v = value.trim().replace(/;+\s*$/, '').trim();
  let m = /^(?:__e|event)\s*\.\s*([A-Za-z_$][\w$]*)$/.exec(v);
  if (m) return m[1];
  m = /^(?:__e|event)\s*\[\s*['"]([^'"]+)['"]\s*\]$/.exec(v);
  if (m) return m[1];
  return null;
}

export function generateReplacement(fn: PipelineFunction): CodeRewrite | null {
  if (fn.id !== 'code') return null;
  const raw = fn.conf?.code;
  const code = typeof raw === 'string' ? raw : '';
  if (!code.trim()) return null;

  const src = stripComments(code);
  const filter = inheritFilter(fn.filter);
  const withFilter = filter ? { filter } : {};
  const notes: string[] = [];
  const emitted: Emitted[] = [];

  // Eval add/remove rows are accumulated across the assignment and rename
  // detectors and combined into a single Eval, ordered by source position.
  const evalAdds: { at: number; name: string; value: string }[] = [];
  const evalRemoves: { at: number; name: string }[] = [];

  // --- A. JSON.parse(<event field>) -> Parser (Serde, extract JSON) ---
  const jsonRe =
    /JSON\s*\.\s*parse\s*\(\s*(?:__e|event)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\])/;
  const jsonM = jsonRe.exec(src);
  if (jsonM) {
    const field = jsonM[1] || jsonM[2] || '_raw';
    emitted.push({
      at: jsonM.index,
      fn: { id: 'serde', ...withFilter, conf: { mode: 'extract', type: 'json', srcField: field } },
    });
    if (!/Object\s*\.\s*assign\s*\(\s*(?:__e|event)\b/.test(src)) {
      notes.push(
        `Detected JSON.parse of "${field}" but no Object.assign onto the event — confirm the Parser should extract into the event root.`,
      );
    }
  }

  // --- B. Field assignments __e.x = <expr> / __e['x'] = <expr> -> Eval add ---
  // The RHS is kept verbatim: `__e` and bare field names are both valid inside
  // an Eval value expression, so no translation is needed (and none can go wrong).
  const assignRe =
    /(?:__e|event)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\])\s*=(?!=)\s*([^\n;]+)/g;
  let am: RegExpExecArray | null;
  let skippedInternal = false;
  while ((am = assignRe.exec(src))) {
    const name = am[1] || am[2];
    if (!name) continue;
    if (name.startsWith('__')) {
      // Internal / error markers (e.g. __parse_error) — don't generate these.
      skippedInternal = true;
      continue;
    }
    evalAdds.push({ at: am.index, name, value: am[3].trim() });
  }
  if (skippedInternal) {
    notes.push(
      'Skipped assignment(s) to internal `__`-prefixed fields (e.g. error markers) — add them manually if required.',
    );
  }

  // --- C. delete __e.x -> Eval remove ---
  const delRe = /\bdelete\s+(?:__e|event)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\])/g;
  let dm: RegExpExecArray | null;
  while ((dm = delRe.exec(src))) {
    const name = dm[1] || dm[2];
    if (name) evalRemoves.push({ at: dm.index, name });
  }

  // --- D. Rename-map literal applied generically -> Eval add (+ remove) ---
  // e.g. `const RENAMES = { 'actor.id': 'user_id', ... }` fed through an
  // Object.entries loop. We read the map directly rather than interpret the loop.
  // A rename map only *replaces* its source fields if the loop also deletes them
  // (typically via a `pluck`-style helper: `delete cur[leaf]`). When it does, the
  // flat sources are queued for removal so the post-pass below can turn them into
  // Rename rows; when it doesn't, the map is a copy and the sources stay.
  const mapSourceRemoved = /\bdelete\s+[A-Za-z_$][\w$]*\s*\[/.test(src);
  const appliesGenerically = /Object\s*\.\s*entries\s*\(/.test(src) && /(?:__e|event)\s*\[/.test(src);
  if (appliesGenerically) {
    const mapRe = /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*\{([^{}]*)\}/g;
    let mm: RegExpExecArray | null;
    while ((mm = mapRe.exec(src))) {
      const pairRe = /['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g;
      const pairs: [string, string][] = [];
      let pm: RegExpExecArray | null;
      while ((pm = pairRe.exec(mm[1]))) pairs.push([pm[1], pm[2]]);
      if (pairs.length < 2) continue; // not a rename map
      let nested = 0;
      for (const [srcPath, dst] of pairs) {
        evalAdds.push({ at: mm.index, name: dst, value: '__e.' + srcPath });
        if (srcPath.includes('.')) nested++;
        else if (mapSourceRemoved) evalRemoves.push({ at: mm.index, name: srcPath });
      }
      if (nested > 0) {
        notes.push(
          `${nested} rename${nested === 1 ? '' : 's'} read a nested path (e.g. \`actor.id\`) into a new top-level field — the built-in Rename can't flatten nested paths, so these stay as Eval and their nested source is left in place. Prune it manually if needed.`,
        );
      }
    }
  }

  // Post-pass: separate true renames from field creation, per Cribl's own split
  // (docs: Rename "alters only field names"; Eval creates/derives fields). A row
  // that copies one flat field verbatim (`__e.old` / `event['old']`) into a new
  // name *and* removes that source is a rename -> emit a Rename function. Anything
  // that computes a value, or derives a field while keeping the source, stays Eval.
  const renamePairs: { at: number; currentName: string; newName: string }[] = [];
  if (evalAdds.length && evalRemoves.length) {
    const removeNames = new Set(evalRemoves.map((r) => r.name));
    const keptAdds: typeof evalAdds = [];
    for (const add of evalAdds) {
      const srcField = pureFieldRef(add.value);
      if (srcField && !srcField.includes('.') && srcField !== add.name && removeNames.has(srcField)) {
        renamePairs.push({ at: add.at, currentName: srcField, newName: add.name });
      } else {
        keptAdds.push(add);
      }
    }
    if (renamePairs.length) {
      // The renamed sources are consumed by the Rename function, not the Eval.
      const consumed = new Set(renamePairs.map((r) => r.currentName));
      evalAdds.length = 0;
      evalAdds.push(...keptAdds);
      const remaining = evalRemoves.filter((r) => !consumed.has(r.name));
      evalRemoves.length = 0;
      evalRemoves.push(...remaining);
    }
  }

  // Emit the Rename function (id 'rename'): conf shape { baseFields, rename:[{currentName,newName}] }.
  if (renamePairs.length) {
    const ordered = renamePairs.slice().sort((a, b) => a.at - b.at);
    const seen = new Set<string>();
    const rename: { currentName: string; newName: string }[] = [];
    for (const r of ordered) {
      if (seen.has(r.currentName)) continue;
      seen.add(r.currentName);
      rename.push({ currentName: r.currentName, newName: r.newName });
    }
    emitted.push({
      at: ordered[0].at,
      fn: { id: 'rename', ...withFilter, conf: { baseFields: [], rename } },
    });
  }

  // Combine remaining (field-creating) Eval rows into one Eval at the earliest offset.
  if (evalAdds.length || evalRemoves.length) {
    const at = Math.min(...evalAdds.map((r) => r.at), ...evalRemoves.map((r) => r.at));
    const conf: Record<string, unknown> = {};
    if (evalAdds.length) {
      conf.add = evalAdds
        .slice()
        .sort((a, b) => a.at - b.at)
        .map((r) => ({ name: r.name, value: r.value }));
    }
    if (evalRemoves.length) {
      const ordered = evalRemoves.slice().sort((a, b) => a.at - b.at).map((r) => r.name);
      conf.remove = [...new Set(ordered)];
    }
    emitted.push({ at, fn: { id: 'eval', ...withFilter, conf } });
    if (/\bif\s*\(/.test(src)) {
      notes.push(
        'The original has conditional (`if`) logic; generated Eval rows run unconditionally — review any guards.',
      );
    }
  }

  // --- E. .replace()/.replaceAll() -> Mask ---
  const replRe =
    /(?:(?:__e|event)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\.\s*replace(?:All)?\s*\(\s*(\/(?:\\.|[^/\n])+\/[gimsuy]*|['"][^'"\n]*['"])\s*,\s*([^)\n]+)\)/g;
  let rm: RegExpExecArray | null;
  while ((rm = replRe.exec(src))) {
    const field = rm[1];
    emitted.push({
      at: rm.index,
      fn: {
        id: 'mask',
        ...withFilter,
        conf: { rules: [{ matchRegex: rm[2], replaceExpr: rm[3].trim() }], fields: [field] },
      },
    });
    notes.push(`Generated a Mask rule from a .replace() on "${field}" — verify the regex and replacement expression.`);
  }

  // --- F. .match()/.exec() -> Regex Extract ---
  const matchRe =
    /(?:(?:__e|event)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\.\s*(?:match|exec)\s*\(\s*(\/(?:\\.|[^/\n])+\/[gimsuy]*)/g;
  let xm: RegExpExecArray | null;
  while ((xm = matchRe.exec(src))) {
    const field = xm[1];
    emitted.push({
      at: xm.index,
      fn: { id: 'regex_extract', ...withFilter, conf: { source: field, regex: xm[2] } },
    });
    notes.push(`Generated a Regex Extract from a .match() on "${field}" — name the capture groups to populate fields.`);
  }

  if (emitted.length === 0) return null;

  emitted.sort((a, b) => a.at - b.at);
  return {
    functions: emitted.map((e) => e.fn),
    notes,
    fullyTranslated: notes.length === 0,
  };
}
