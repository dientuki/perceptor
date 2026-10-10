#!/usr/bin/env node
// Production npm advisory gate (085-dependency-update-cadence). For each service — api, web,
// worker, or just the one passed as the first positional argument — runs `npm audit --json
// --omit=dev` with that service's directory as cwd, reconciles what it reports against
// tools/audit/allowlist.json and exits non-zero the moment anything needs a human's attention.
//
// The one rule this script cannot get wrong (see plan.md's Risks, row 1): `npm audit` exits
// non-zero whenever it finds anything, which is almost always, so the child's exit code says
// nothing about whether the audit actually ran. Every branch below reads stdout and decides on
// the parse, never on the exit code — valid JSON carrying a `vulnerabilities` object is a
// completed audit regardless of status; anything else (empty stdout, a registry error, a
// truncated response) is a failed invocation and is reported as exactly that, never as a pass.
//
// Reconciliation, per service:
//   - a reported advisory at `high`/`critical` with no matching allowlist entry -> FAIL, naming
//     the advisory id(s) and the package (REQ-8);
//   - a reported advisory at `moderate` or below with no entry -> printed as a note, never fails
//     the gate (REQ-7's threshold is `high`);
//   - an allowlist entry matching nothing the audit currently reports -> FAIL as stale (REQ-9);
//   - an allowlist entry with an empty/missing `reachability` or `reopenCondition` -> FAIL,
//     naming the entry, rather than being silently honoured (REQ-6);
//   - everything else -> pass, printing which allowlist entries were honoured (REQ-10).
//
// Run through bin/audit (Article I) — never directly on the host.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const ALL_SERVICES = ["api", "web", "worker"];
const GATE_THRESHOLD = ["high", "critical"];

const requested = process.argv[2];
if (requested && !ALL_SERVICES.includes(requested)) {
  console.error(`Unknown service "${requested}" — expected one of ${ALL_SERVICES.join(", ")}.`);
  process.exit(1);
}
const servicesToRun = requested ? [requested] : ALL_SERVICES;

const allowlistPath = path.join(here, "allowlist.json");
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
const entries = Array.isArray(allowlist.entries) ? allowlist.entries : [];

/** Extracts a GHSA id out of an advisory's github.com/advisories URL. */
function extractGhsaId(url) {
  if (typeof url !== "string") return null;
  const match = url.match(/GHSA-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+/i);
  return match ? match[0] : null;
}

/**
 * Runs `npm audit --json --omit=dev` inside the given service directory and returns the parsed
 * `vulnerabilities` map, or null when the invocation itself failed (never throws, never guesses
 * from the exit code).
 */
function runAudit(service) {
  const cwd = path.join(repoRoot, "services", service);
  const result = spawnSync("npm", ["audit", "--json", "--omit=dev"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
  });

  if (result.error) {
    return { ok: false, reason: `could not spawn npm: ${result.error.message}` };
  }

  const stdout = result.stdout ?? "";
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    const snippet = (result.stderr || stdout || "").slice(0, 500);
    return { ok: false, reason: `stdout was not valid JSON (${err.message}). Output: ${snippet}` };
  }

  if (parsed === null || typeof parsed !== "object" || typeof parsed.vulnerabilities !== "object" || parsed.vulnerabilities === null) {
    return { ok: false, reason: "parsed JSON carried no vulnerabilities map" };
  }

  return { ok: true, vulnerabilities: parsed.vulnerabilities };
}

/** Flattens npm audit's per-package vulnerabilities map into one finding per package. */
function toFindings(vulnerabilities) {
  const findings = [];
  for (const [pkg, data] of Object.entries(vulnerabilities)) {
    const severity = data?.severity ?? "unknown";
    const via = Array.isArray(data?.via) ? data.via : [];
    const advisories = via
      .filter((v) => v && typeof v === "object")
      .map((v) => extractGhsaId(v.url))
      .filter((id) => id != null);
    findings.push({ package: pkg, severity, advisories });
  }
  return findings;
}

let hadFailure = false;
const invalidEntries = new Set();

// REQ-6 / AC-17: reject a reason-less entry outright, before it can be honoured by anything.
for (const entry of entries) {
  const reachability = typeof entry.reachability === "string" ? entry.reachability.trim() : "";
  const reopenCondition = typeof entry.reopenCondition === "string" ? entry.reopenCondition.trim() : "";
  if (!reachability || !reopenCondition) {
    invalidEntries.add(entry);
  }
}

const allHonoured = [];

for (const service of servicesToRun) {
  console.log(`\n[${service}] running npm audit --omit=dev …`);
  const audit = runAudit(service);

  if (!audit.ok) {
    console.error(`[${service}] FAIL: the audit itself did not complete — ${audit.reason}`);
    hadFailure = true;
    continue;
  }

  const findings = toFindings(audit.vulnerabilities);
  const scopedEntries = entries.filter((e) => e.service === service);

  for (const entry of scopedEntries) {
    if (invalidEntries.has(entry)) {
      console.error(
        `[${service}] FAIL: allowlist entry for "${entry.package}" has no reachability argument ` +
          `and/or no reopen condition — an entry with no reason is rejected, not honoured.`,
      );
      hadFailure = true;
    }
  }

  const honouredEntries = new Set();

  for (const finding of findings) {
    const entry = scopedEntries.find((e) => e.package === finding.package);

    if (GATE_THRESHOLD.includes(finding.severity)) {
      if (!entry || invalidEntries.has(entry)) {
        const advisoryList = finding.advisories.length > 0 ? finding.advisories.join(", ") : "(no advisory id reported)";
        console.error(
          `[${service}] FAIL: ${finding.severity} advisory ${advisoryList} in "${finding.package}" is not in the allowlist.`,
        );
        hadFailure = true;
        continue;
      }
      honouredEntries.add(entry);
    } else {
      console.log(
        `[${service}] note: ${finding.severity} advisory in "${finding.package}" ` +
          `(${finding.advisories.join(", ") || "no advisory id"}) — below gate threshold, not required to be allowlisted.`,
      );
      if (entry && !invalidEntries.has(entry)) honouredEntries.add(entry);
    }
  }

  // REQ-9: an allowlist entry matching nothing currently reported is stale.
  for (const entry of scopedEntries) {
    if (invalidEntries.has(entry)) continue;
    const stillReported = findings.some((f) => f.package === entry.package);
    if (!stillReported) {
      console.error(
        `[${service}] FAIL: allowlist entry for "${entry.package}" (${entry.versionRange}) is stale — ` +
          `the audit no longer reports it. Remove the entry or re-verify it.`,
      );
      hadFailure = true;
    }
  }

  for (const entry of honouredEntries) {
    console.log(`[${service}] honoured: "${entry.package}" (${entry.versionRange}) — ${entry.advisories.join(", ") || "parent, no advisory of its own"}`);
    allHonoured.push({ service, entry });
  }
}

if (allHonoured.length > 0) {
  console.log(`\nAllowlist entries honoured this run:`);
  for (const { service, entry } of allHonoured) {
    console.log(`  [${service}] ${entry.package} (${entry.versionRange})`);
  }
}

if (hadFailure) {
  console.error("\naudit gate: FAIL");
  process.exit(1);
}

console.log("\naudit gate: PASS");
