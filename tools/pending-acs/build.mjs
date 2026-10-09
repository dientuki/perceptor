// Regenerates the mechanical half of docs/spec/pending-acs.md from the specs themselves:
// the headline counts, the per-spec table and the per-blocker rollup. The `obs` column is
// hand-written judgment and is carried over verbatim, keyed by spec number — this script never
// invents one. A spec that reaches 100% loses its row; a spec that gains its first open
// criterion arrives with the OBS_PLACEHOLDER marker for a human (or /pending-acs) to fill in.
//
// Run through bin/pending-acs (Article I: nothing runs on the host).
//   --check   report staleness and exit 1 instead of writing

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const REPO = "/repo";
const FEATURES = path.join(REPO, "docs/spec/features");
const DOC = path.join(REPO, "docs/spec/pending-acs.md");
const OBS_PLACEHOLDER = "**[OBS PENDIENTE DE ESCRIBIR]**";

const AC_LINE = /^- \[([ x])\] \*\*([^*]+?)\*\*/gm;
const SECTION = /^## Acceptance Criteria\s*$([\s\S]*?)(?=^## )/m;
const STATUS = /^status:\s*(.+)$/m;

function marker(name) {
  return {
    begin: `<!-- pending-acs:begin ${name} -->`,
    end: `<!-- pending-acs:end ${name} -->`,
  };
}

function splice(doc, name, body) {
  const { begin, end } = marker(name);
  const from = doc.indexOf(begin);
  const to = doc.indexOf(end);
  if (from === -1 || to === -1) {
    throw new Error(`docs/spec/pending-acs.md is missing the ${name} markers`);
  }
  return doc.slice(0, from + begin.length) + "\n" + body + "\n" + doc.slice(to);
}

async function scan() {
  const dirs = (await readdir(FEATURES, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();

  const specs = [];
  for (const dir of dirs) {
    let text;
    try {
      text = await readFile(path.join(FEATURES, dir, "spec.md"), "utf8");
    } catch {
      continue;
    }
    const section = text.match(SECTION);
    if (!section) continue;

    const items = [...section[1].matchAll(AC_LINE)];
    // The marker carries a parenthetical gloss on many criteria ("AC-4 (failure path)"); the
    // table wants the bare number, since the gloss is already in the spec.
    const open = items
      .filter(([, box]) => box === " ")
      .map(([, , name]) => name.replace(/\s*\(.*/, "").trim().replace(/^AC-/, ""));

    specs.push({
      num: dir.slice(0, 3),
      slug: dir.slice(4),
      status: (text.match(STATUS)?.[1] ?? "?").trim(),
      total: items.length,
      open,
    });
  }
  return specs;
}

function readObs(doc) {
  const obs = new Map();
  for (const line of doc.split("\n")) {
    if (!/^\| \d{3} \|/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim());
    obs.set(cells[1], cells[6] ?? "");
  }
  return obs;
}

// The blocker rollup is derived, not maintained: each obs opens with a bolded label naming what
// the criteria are waiting on, and that label is the grouping key.
function blockerOf(obs) {
  const label = obs.match(/^\*\*(.+?)\.\*\*/);
  return label ? label[1] : "Sin clasificar";
}

function render(specs, obs, today) {
  const pending = specs.filter((s) => s.open.length > 0);
  const withAcs = specs.length;
  const openCount = pending.reduce((n, s) => n + s.open.length, 0);
  const totalAcs = specs.reduce((n, s) => n + s.total, 0);
  const verified = totalAcs - openCount;
  const pct = Math.round((verified / totalAcs) * 100);

  const stats = [
    "| | |",
    "| :-- | --: |",
    `| Specs con ACs pendientes | **${pending.length}** de ${withAcs} |`,
    `| ACs pendientes | **${openCount}** |`,
    "| ACs totales del proyecto | " + totalAcs + " |",
    `| ACs verificados | ${verified} (${pct}%) |`,
  ].join("\n");

  const rows = [
    "| spec | titulo | status | AC pendientes | detalle AC | obs |",
    "| :-- | :-- | :-- | :-- | :-- | :-- |",
  ];
  for (const s of [...pending].reverse()) {
    const cell = obs.get(s.num)?.trim() || OBS_PLACEHOLDER;
    rows.push(
      `| ${s.num} | ${s.slug} | ${s.status} | ${s.open.length}/${s.total} | ${s.open.join(", ")} | ${cell} |`,
    );
  }

  const groups = new Map();
  for (const s of pending) {
    const key = blockerOf(obs.get(s.num) ?? "");
    const g = groups.get(key) ?? { acs: 0, specs: [] };
    g.acs += s.open.length;
    g.specs.push(s.num);
    groups.set(key, g);
  }
  const ranked = [...groups].sort((a, b) => b[1].acs - a[1].acs);
  const top2 = ranked.slice(0, 2).reduce((n, [, g]) => n + g.acs, 0);
  const blockers = [
    `Los ${openCount} ACs pendientes no son ${openCount} problemas distintos. Se reducen a ${ranked.length} destrabes, y los dos primeros se llevan el ${Math.round((top2 / openCount) * 100)}%:`,
    "",
    "| blocker | ACs | specs |",
    "| :-- | --: | :-- |",
    ...ranked.map(([k, g]) => `| ${k} | ${g.acs} | ${g.specs.sort().join(", ")} |`),
  ].join("\n");

  const intro = [
    `Medido el **${today}**. Una fila por spec que todavia tiene al menos un \`- [ ]\` bajo`,
    "`## Acceptance Criteria`; las " +
      (withAcs - pending.length) +
      " specs que no aparecen estan en 100%.",
  ].join("\n");

  return { stats, rows: rows.join("\n"), blockers, intro, pending, openCount };
}

const check = process.argv.includes("--check");
const today = new Date().toISOString().slice(0, 10);

const before = await readFile(DOC, "utf8");
const specs = await scan();
const obs = readObs(before);
const out = render(specs, obs, today);

let doc = before;
doc = splice(doc, "intro", out.intro);
doc = splice(doc, "stats", out.stats);
doc = splice(doc, "specs", out.rows);
doc = splice(doc, "blockers", out.blockers);

const nums = new Set(out.pending.map((s) => s.num));
const dropped = [...obs.keys()].filter((n) => !nums.has(n));
const added = out.pending.filter((s) => !obs.has(s.num)).map((s) => s.num);
const needObs = out.pending
  .filter((s) => (obs.get(s.num) ?? "").includes("OBS PENDIENTE"))
  .map((s) => s.num);

console.log(`${out.pending.length} specs con ACs pendientes, ${out.openCount} ACs abiertos.`);
if (dropped.length) console.log(`Cerradas al 100% (fila eliminada): ${dropped.join(", ")}`);
if (added.length) console.log(`Nuevas en la tabla (necesitan obs): ${added.join(", ")}`);
if (needObs.length) console.log(`Con obs sin escribir: ${needObs.join(", ")}`);

if (doc === before) {
  console.log("docs/spec/pending-acs.md ya esta al dia.");
  process.exit(0);
}

if (check) {
  console.error("docs/spec/pending-acs.md esta desactualizado. Corré bin/pending-acs.");
  process.exit(1);
}

await writeFile(DOC, doc);
console.log("docs/spec/pending-acs.md actualizado.");
