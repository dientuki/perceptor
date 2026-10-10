#!/usr/bin/env node
// Comment locator convention gate (086-comment-locator-convention). For each service — api, web,
// worker, or just the one passed as the first positional argument — walks services/<svc>/src for
// *.ts/*.tsx files, extracts every comment (line and block) plus every Spanish it(...)/describe(...)/
// test(...) string in a *.spec.ts file, and applies four rules:
//
//   - Spanish prose in a comment or a *.spec.ts test description -> FAIL (REQ-3/REQ-4/REQ-12).
//   - a comment referencing a spec requirement in any spelling other than the REQ-1 grammar
//     (`Spec NNN, <ref>[ <ref>...]`, `;` between specs) -> FAIL, printing the grammar (REQ-1, AC-5).
//   - a well-formed locator naming a spec directory that does not exist under
//     docs/spec/features/ -> FAIL (AC-3).
//   - a well-formed locator naming a REQ/NFR/AC id absent from that spec's spec.md, or a Tnnn id
//     absent from its tasks.md (or failing outright when tasks.md itself is missing) -> FAIL (AC-4).
//
// An English comment with no spec reference always passes (REQ-7) — that is deliberate, not a
// loophole: ~5,000 of them exist in the tree and a gate that failed on them would be unmergeable
// the day it landed.
//
// REQ-1b carves out two structural exceptions where a reference may sit inline inside prose rather
// than being the whole line: a comment immediately preceding `describe(` in a *.spec.ts file (the
// Article IX test header), and the hardcoded media-roots.service.ts guard neighbourhood below.
// There is deliberately no allowlist file anywhere in this script (NFR-4) — an exemption list is
// exactly the "leave it for later" clause this feature retires.
//
// A sixth, narrower check rides alongside the five above: a comment that is itself nothing but a
// well-formed locator, immediately followed (a blank line is fine, a line of code is not) by a
// prose comment carrying no spec reference token at all, is also FAIL ([orphan-prose-after-locator]).
// This is the specific abuse the REQ-7 leniency above invites — stamping a bare locator on top of
// an explanatory paragraph instead of letting the locator *be* the whole comment, which is what the
// root CLAUDE.md's "never prose on its own" line actually requires. It is a local tightening, not
// one of 086's own numbered requirements, so it carries no REQ/AC id of its own.
//
// Run through bin/comments (Article I) — never directly on the host.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const ALL_SERVICES = ["api", "web", "worker"];

// REQ-1b exception-3: a short, hardcoded list naming where an already-sanctioned Article XI
// guard-doc-comment exception lives. This names the exception, it does not excuse a new one.
const EXCEPTION_3_FILES = [
  {
    file: "services/api/src/media-roots/media-roots.service.ts",
    methods: ["resolveFromRoot", "isInsideRoot", "realpathOfDeepestExisting"],
  },
];

// Spanish accent/punctuation characters, unambiguous in any context.
const SPANISH_ACCENTS = /[áéíóúñüÁÉÍÓÚÑÜ¿¡]/;

// Spanish function words that are NOT also English words. Deliberately excludes the ambiguous
// ones named in plan.md (`no`, `la`, `son`, `si`, `me`, `van`, `ten`, and anything like them) —
// false negatives are debt, false positives are a broken build on someone else's branch.
const SPANISH_WORDS = [
  "que",
  "de",
  "del",
  "los",
  "las",
  "con",
  "para",
  "por",
  "como",
  "pero",
  "esto",
  "esta",
  "estos",
  "estas",
  "desde",
  "hasta",
  "cuando",
  "donde",
  "porque",
  "tambien",
  "también",
  "entonces",
  "cada",
  "otro",
  "otra",
  "sobre",
  "muy",
  "ese",
  "esa",
  "eso",
  "esos",
  "esas",
  "hay",
  "está",
  "están",
  "estan",
  "puede",
  "pueden",
  "debe",
  "deben",
  "sólo",
  "solo",
  "nunca",
  "siempre",
  "mismo",
  "misma",
  "acá",
  "aca",
  "aquí",
  "aqui",
  "ahí",
  "ahi",
  "adentro",
  "afuera",
  "dentro",
  "fuera",
  "todavía",
  "todavia",
  "ya",
  "aún",
  "aun",
  "según",
  "segun",
  "entre",
  "sino",
  "tanto",
  "varios",
  "varias",
  "alguna",
  "alguno",
  "algunos",
  "algunas",
  "ninguna",
  "ninguno",
  "nada",
  "algo",
  "alguien",
  "nadie",
  "quien",
  "quién",
  "cual",
  "cuál",
  "cuales",
  "cuyo",
  "suyo",
  "nuestra",
  "nuestro",
  "ella",
  "ellas",
  "ellos",
  "él",
  "usted",
  "ustedes",
  "nosotros",
  "hacia",
  "contra",
  "bajo",
  "ante",
  "tras",
  "durante",
  "mediante",
  "excepto",
  "salvo",
  "aunque",
  "mientras",
  "pues",
  "además",
  "ademas",
  "incluso",
  "igual",
  "cosa",
  "cosas",
  "manera",
  "razón",
  "razon",
  "ruta",
  "raíz",
  "raiz",
  "corre",
  "escapa",
  "arriba",
  "abajo",
  "ídem",
  "idem",
  "dueño",
  "dueno",
  "pregunta",
  "todo",
  "sin",
  "sólo",
  "acerca",
  "necesita",
  "busca",
  "toma",
  "devuelve",
  "hace",
  "falta",
];
const SPANISH_WORD_REGEX = new RegExp(`\\b(${SPANISH_WORDS.join("|")})\\b`, "i");

const LOCATOR_GRAMMAR_MESSAGE =
  "expected the REQ-1 grammar: `Spec NNN, <ref>[ <ref>...]`, each <ref> one of REQ-n/NFR-n/AC-n/Tnnn, " +
  "specs separated by `; `, no other text on the line";

const REF_PATTERN = "(?:REQ|NFR|AC)-\\d+[a-z]?|T\\d{3}";
const SPEC_GROUP_PATTERN = `Spec \\d{3}, (?:${REF_PATTERN})(?: (?:${REF_PATTERN}))*`;
const SPEC_GROUP_GLOBAL = new RegExp(SPEC_GROUP_PATTERN, "g");
const FULL_LOCATOR_LINE = new RegExp(`^(?:${SPEC_GROUP_PATTERN})(?:; (?:${SPEC_GROUP_PATTERN}))*$`);
// Loose detector for "something that looks like a reference is present at all" — used to decide
// whether the reference rules apply to a comment in the first place.
const DETECTION_TOKEN = new RegExp(`\\b(?:${REF_PATTERN})\\b`, "g");

/** Strips every quoted run ('…', "…", `…`) out of a string before testing it for Spanish. */
export function stripQuotedRuns(text) {
  return text.replace(/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g, " ");
}

/** True when `text` contains Spanish prose, quoted runs excluded. */
export function isSpanishText(text) {
  const stripped = stripQuotedRuns(text);
  if (SPANISH_ACCENTS.test(stripped)) return true;
  if (SPANISH_WORD_REGEX.test(stripped)) return true;
  return false;
}

/**
 * Validates a comment's text against the REQ-1 locator grammar.
 *
 * Returns one of:
 *   { kind: 'none' }                                 — no reference token present at all.
 *   { kind: 'malformed' }                             — a reference is present but not spelled
 *                                                        per REQ-1 (outside an exception) or a
 *                                                        bare token escapes every well-formed group
 *                                                        (inside an exception too).
 *   { kind: 'ok', groups: [{ specNumber, refs: [...] }] } — every reference resolved to a
 *                                                        well-formed `Spec NNN, <ref>...` group.
 */
export function validateReferenceText(text, { exceptionContext }) {
  const tokens = [...text.matchAll(DETECTION_TOKEN)];
  if (tokens.length === 0) return { kind: "none" };

  const groupMatches = [...text.matchAll(SPEC_GROUP_GLOBAL)];

  const uncovered = tokens.some((token) => {
    const start = token.index;
    const end = start + token[0].length;
    return !groupMatches.some((g) => g.index <= start && g.index + g[0].length >= end);
  });
  if (uncovered) return { kind: "malformed" };

  if (!exceptionContext && !FULL_LOCATOR_LINE.test(text.trim())) {
    return { kind: "malformed" };
  }

  const groups = groupMatches.map((g) => {
    const [specNumber, ...rest] = g[0].match(/\d{3}|(?:REQ|NFR|AC)-\d+[a-z]?|T\d{3}/g);
    return { specNumber, refs: rest };
  });
  return { kind: "ok", groups };
}

/** Scans `source` char by char, tracking string/template/comment state, and returns every comment
 * as { kind: 'line'|'block', startLine, endLine, text }. A `//` or `/*` inside a quoted run is
 * never read as a comment start. */
function extractRawComments(source) {
  const comments = [];
  let i = 0;
  let line = 1;
  const n = source.length;
  let state = "NORMAL";
  let buf = "";
  let commentStartLine = 0;

  while (i < n) {
    const c = source[i];
    const c2 = i + 1 < n ? source[i + 1] : "";

    if (state === "NORMAL") {
      if (c === "/" && c2 === "/") {
        state = "LINE_COMMENT";
        buf = "";
        commentStartLine = line;
        i += 2;
        continue;
      }
      if (c === "/" && c2 === "*") {
        state = "BLOCK_COMMENT";
        buf = "";
        commentStartLine = line;
        i += 2;
        continue;
      }
      if (c === "'") {
        state = "SINGLE";
        i++;
        continue;
      }
      if (c === '"') {
        state = "DOUBLE";
        i++;
        continue;
      }
      if (c === "`") {
        state = "TEMPLATE";
        i++;
        continue;
      }
      if (c === "\n") line++;
      i++;
      continue;
    }

    if (state === "SINGLE" || state === "DOUBLE") {
      const quote = state === "SINGLE" ? "'" : '"';
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) {
        state = "NORMAL";
        i++;
        continue;
      }
      if (c === "\n") {
        // A real single/double-quoted string never spans a line; bail out rather than eat the
        // rest of the file in string state.
        line++;
        state = "NORMAL";
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (state === "TEMPLATE") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        state = "NORMAL";
        i++;
        continue;
      }
      if (c === "\n") line++;
      i++;
      continue;
    }

    if (state === "LINE_COMMENT") {
      if (c === "\n") {
        comments.push({ kind: "line", startLine: commentStartLine, endLine: commentStartLine, text: buf });
        state = "NORMAL";
        line++;
        i++;
        continue;
      }
      buf += c;
      i++;
      continue;
    }

    if (state === "BLOCK_COMMENT") {
      if (c === "*" && c2 === "/") {
        comments.push({ kind: "block", startLine: commentStartLine, endLine: line, text: buf });
        state = "NORMAL";
        i += 2;
        continue;
      }
      if (c === "\n") line++;
      buf += c;
      i++;
      continue;
    }
  }

  if (state === "LINE_COMMENT") {
    comments.push({ kind: "line", startLine: commentStartLine, endLine: commentStartLine, text: buf });
  }

  return comments;
}

/** Strips a block comment's `*` continuation-line prefixes and joins it into one logical text. */
function flattenBlockComment(rawText) {
  const lines = rawText.split("\n");
  return lines
    .map((l, idx) => (idx === 0 ? l : l.replace(/^\s*\*\s?/, "")))
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(" ");
}

/** Merges consecutive standalone `//` line comments (no code before them, no gap between lines)
 * into one logical unit, matching a multi-line Spanish paragraph or a `Spec NNN, ...; Spec MMM,
 * ...` block written across several lines. */
function mergeComments(rawComments, sourceLines) {
  const units = [];
  let i = 0;
  while (i < rawComments.length) {
    const c = rawComments[i];
    if (c.kind === "block") {
      units.push({ startLine: c.startLine, endLine: c.endLine, text: flattenBlockComment(c.text) });
      i++;
      continue;
    }

    const isStandalone = sourceLines[c.startLine - 1].trim().startsWith("//");
    if (!isStandalone) {
      units.push({ startLine: c.startLine, endLine: c.startLine, text: c.text.trim() });
      i++;
      continue;
    }

    const group = [c];
    let j = i + 1;
    while (j < rawComments.length && rawComments[j].kind === "line") {
      const prevLine = group[group.length - 1].startLine;
      const cur = rawComments[j];
      const curStandalone = sourceLines[cur.startLine - 1].trim().startsWith("//");
      if (curStandalone && cur.startLine === prevLine + 1) {
        group.push(cur);
        j++;
      } else {
        break;
      }
    }
    units.push({
      startLine: group[0].startLine,
      endLine: group[group.length - 1].startLine,
      text: group.map((g) => g.text.trim()).join(" "),
      nextCodeLineIndex: group[group.length - 1].startLine, // 1-based line right after the unit
    });
    i = j;
  }
  return units;
}

/** Finds the first non-blank, non-comment-only source line strictly after `afterLine` (1-based),
 * trimmed. Used for REQ-1b's structural exception detection. */
function firstCodeLineAfter(sourceLines, afterLine) {
  for (let idx = afterLine; idx < sourceLines.length; idx++) {
    const trimmed = sourceLines[idx].trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("//")) continue;
    return trimmed;
  }
  return "";
}

function walk(dir, exts) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function toRepoRelative(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

/** Builds { '048': '048-shorts-category', ... } from docs/spec/features/*. */
function loadSpecDirIndex() {
  const base = path.join(repoRoot, "docs", "spec", "features");
  const index = new Map();
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return index;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^(\d{3})-/);
    if (match) index.set(match[1], entry.name);
  }
  return index;
}

const specTextCache = new Map();
function readSpecFile(specDirName, fileName) {
  const key = `${specDirName}/${fileName}`;
  if (specTextCache.has(key)) return specTextCache.get(key);
  const full = path.join(repoRoot, "docs", "spec", "features", specDirName, fileName);
  let content = null;
  try {
    content = readFileSync(full, "utf8");
  } catch {
    content = null;
  }
  specTextCache.set(key, content);
  return content;
}

/** Finds the line in `content` that defines `refId` (e.g. "REQ-1b", "T002"), bold-markdown style
 * (`**REQ-1b**` / `**T002**`), returning its trimmed text or null. */
function findRefLine(content, refId) {
  if (content == null) return null;
  const lines = content.split("\n");
  const needle = `**${refId}`;
  for (const line of lines) {
    if (line.includes(needle)) return line.trim();
  }
  return null;
}

function isException3(fileRel, sourceLines, unit) {
  const entry = EXCEPTION_3_FILES.find((e) => e.file === fileRel);
  if (!entry) return false;
  const nextCode = firstCodeLineAfter(sourceLines, unit.endLine);
  return entry.methods.some((m) => new RegExp(`\\b${m}\\s*\\(`).test(nextCode));
}

function isException2(fileRel, sourceLines, unit) {
  if (!fileRel.endsWith(".spec.ts") && !fileRel.endsWith(".spec.tsx")) return false;
  const nextCode = firstCodeLineAfter(sourceLines, unit.endLine);
  return /^describe\s*\(/.test(nextCode);
}

/** Local tightening, no spec id of its own (see the file header): a unit that is nothing but a
 * well-formed locator, immediately followed — a blank line is fine, a line of code is not — by a
 * prose unit carrying no spec reference token at all, is the abuse the REQ-7 leniency invites: a
 * locator stamped beside its own justification instead of being the whole comment. */
function checkOrphanProseAfterLocator(units, sourceLines, fileRel, hadFailureRef, stats) {
  for (let i = 0; i < units.length - 1; i++) {
    const locatorUnit = units[i];
    const proseUnit = units[i + 1];

    const locatorText = locatorUnit.text.trim();
    if (locatorText.length === 0 || !FULL_LOCATOR_LINE.test(locatorText)) continue;

    const proseText = proseUnit.text.trim();
    if (proseText.length === 0) continue;
    if ([...proseText.matchAll(DETECTION_TOKEN)].length > 0) continue;

    let hasCodeBetween = false;
    for (let ln = locatorUnit.endLine + 1; ln < proseUnit.startLine; ln++) {
      if (sourceLines[ln - 1].trim().length > 0) {
        hasCodeBetween = true;
        break;
      }
    }
    if (hasCodeBetween) continue;

    console.error(
      `${fileRel}:${proseUnit.startLine}: FAIL [orphan-prose-after-locator] a prose comment with no ` +
        `spec reference sits right after the pure locator at line ${locatorUnit.startLine} ("${locatorText}") ` +
        `— the locator must be the whole comment; fold the prose into it or delete it`,
    );
    hadFailureRef.value = true;
    stats.orphanProse++;
  }
}

function checkFile(absPath, specDirIndex, hadFailureRef, stats) {
  const fileRel = toRepoRelative(absPath);
  const source = readFileSync(absPath, "utf8");
  const sourceLines = source.split("\n");

  const rawComments = extractRawComments(source);
  const units = mergeComments(rawComments, sourceLines);

  checkOrphanProseAfterLocator(units, sourceLines, fileRel, hadFailureRef, stats);

  for (const unit of units) {
    const text = unit.text;
    if (text.length === 0) continue;

    if (isSpanishText(text)) {
      console.error(`${fileRel}:${unit.startLine}: FAIL [spanish-comment] comment contains Spanish prose: "${text}"`);
      hadFailureRef.value = true;
      stats.spanish++;
      continue;
    }

    const exceptionContext = isException2(fileRel, sourceLines, unit) || isException3(fileRel, sourceLines, unit);
    const verdict = validateReferenceText(text, { exceptionContext });

    if (verdict.kind === "none") continue;

    if (verdict.kind === "malformed") {
      console.error(
        `${fileRel}:${unit.startLine}: FAIL [malformed-reference] "${text}" — ${LOCATOR_GRAMMAR_MESSAGE}`,
      );
      hadFailureRef.value = true;
      stats.malformed++;
      continue;
    }

    for (const group of verdict.groups) {
      const dirName = specDirIndex.get(group.specNumber);
      if (!dirName) {
        console.error(
          `${fileRel}:${unit.startLine}: FAIL [dangling-spec] "Spec ${group.specNumber}" — no docs/spec/features/${group.specNumber}-*/ directory exists`,
        );
        hadFailureRef.value = true;
        stats.danglingSpec++;
        continue;
      }

      const specContent = readSpecFile(dirName, "spec.md");
      let tasksContent;

      for (const ref of group.refs) {
        if (/^T\d{3}$/.test(ref)) {
          if (tasksContent === undefined) tasksContent = readSpecFile(dirName, "tasks.md");
          if (tasksContent == null) {
            console.error(
              `${fileRel}:${unit.startLine}: FAIL [dangling-id] "${ref}" — docs/spec/features/${dirName}/tasks.md does not exist`,
            );
            hadFailureRef.value = true;
            stats.danglingId++;
            continue;
          }
          const line = findRefLine(tasksContent, ref);
          if (!line) {
            console.error(
              `${fileRel}:${unit.startLine}: FAIL [dangling-id] "${ref}" does not appear in docs/spec/features/${dirName}/tasks.md`,
            );
            hadFailureRef.value = true;
            stats.danglingId++;
          } else {
            console.log(`${fileRel}:${unit.startLine}: OK [Spec ${group.specNumber}, ${ref}] ${line}`);
            stats.resolved++;
          }
          continue;
        }

        const line = findRefLine(specContent, ref);
        if (!line) {
          console.error(
            `${fileRel}:${unit.startLine}: FAIL [dangling-id] "${ref}" does not appear in docs/spec/features/${dirName}/spec.md`,
          );
          hadFailureRef.value = true;
          stats.danglingId++;
        } else {
          console.log(`${fileRel}:${unit.startLine}: OK [Spec ${group.specNumber}, ${ref}] ${line}`);
          stats.resolved++;
        }
      }
    }
  }

  if (fileRel.endsWith(".spec.ts") || fileRel.endsWith(".spec.tsx")) {
    const callPattern = /\b(?:it|describe|test)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
    let match;
    while ((match = callPattern.exec(source)) !== null) {
      const literal = match[2];
      if (isSpanishText(literal)) {
        const line = source.slice(0, match.index).split("\n").length;
        console.error(`${fileRel}:${line}: FAIL [spanish-test-description] "${literal}"`);
        hadFailureRef.value = true;
        stats.spanishTestDescription++;
      }
    }
  }
}

function main() {
  const requested = process.argv[2];
  if (requested && !ALL_SERVICES.includes(requested)) {
    console.error(`Unknown service "${requested}" — expected one of ${ALL_SERVICES.join(", ")}.`);
    process.exit(1);
  }
  const servicesToRun = requested ? [requested] : ALL_SERVICES;

  const specDirIndex = loadSpecDirIndex();
  const hadFailureRef = { value: false };
  const stats = {
    resolved: 0,
    spanish: 0,
    malformed: 0,
    danglingSpec: 0,
    danglingId: 0,
    spanishTestDescription: 0,
    orphanProse: 0,
  };

  for (const service of servicesToRun) {
    const srcDir = path.join(repoRoot, "services", service, "src");
    const files = walk(srcDir, [".ts", ".tsx"]);
    console.log(`\n[${service}] scanning ${files.length} files under services/${service}/src …`);
    for (const file of files) {
      checkFile(file, specDirIndex, hadFailureRef, stats);
    }
  }

  console.log(
    `\ncomments gate: resolved=${stats.resolved} spanish=${stats.spanish} malformed=${stats.malformed} ` +
      `dangling-spec=${stats.danglingSpec} dangling-id=${stats.danglingId} ` +
      `spanish-test-description=${stats.spanishTestDescription} orphan-prose=${stats.orphanProse}`,
  );

  if (hadFailureRef.value) {
    console.error("\ncomments gate: FAIL");
    process.exit(1);
  }

  console.log(`\ncomments gate: PASS (${stats.resolved} locators resolved)`);
}

// Only run the gate when this file is executed directly (`node check.mjs`), not when
// check.spec.mjs imports its exports.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
