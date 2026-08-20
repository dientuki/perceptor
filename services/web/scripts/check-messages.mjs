#!/usr/bin/env node
// Catalog parity check (AC-12): every leaf key present in messages/en.json
// must also be present in messages/es.json, and vice versa. Not a test
// framework — a plain script run with `node`, no build step (NFR-6).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const enPath = join(scriptDir, "..", "messages", "en.json");
const esPath = join(scriptDir, "..", "messages", "es.json");

function loadCatalog(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

/**
 * Recursively flattens a nested message catalog into a sorted list of
 * dot-separated leaf key paths, e.g. { auth: { login: { title: '...' } } }
 * -> ['auth.login.title'].
 */
function flattenKeys(node, prefix = "") {
  const keys = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function main() {
  const en = loadCatalog(enPath);
  const es = loadCatalog(esPath);

  const enKeys = new Set(flattenKeys(en));
  const esKeys = new Set(flattenKeys(es));

  const missingFromEs = [...enKeys].filter((key) => !esKeys.has(key)).sort();
  const missingFromEn = [...esKeys].filter((key) => !enKeys.has(key)).sort();

  if (missingFromEs.length === 0 && missingFromEn.length === 0) {
    console.log(`OK: en.json and es.json match exactly (${enKeys.size} keys).`);
    process.exit(0);
  }

  console.error("Catalog parity check failed:");

  if (missingFromEs.length > 0) {
    console.error(
      `\nPresent in en.json, missing from es.json (${missingFromEs.length}):`,
    );
    for (const key of missingFromEs) {
      console.error(`  - ${key}`);
    }
  }

  if (missingFromEn.length > 0) {
    console.error(
      `\nPresent in es.json, missing from en.json (${missingFromEn.length}):`,
    );
    for (const key of missingFromEn) {
      console.error(`  - ${key}`);
    }
  }

  process.exit(1);
}

main();
