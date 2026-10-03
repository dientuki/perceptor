#!/usr/bin/env node
// Generates the published landing page(s) from tools/site/template.html plus one flat
// string catalog per locale (tools/site/<locale>.json). Catalog values are trusted HTML
// fragments and are substituted verbatim, never escaped (see plan.md's Contract Freeze) —
// this script writes markup, it does not sanitize user input.
//
// It is also the parity check (plan.md's "Approach"): every {{key}} in the template must
// have a catalog entry and every catalog entry must be used by the template, in every
// locale. A mismatch prints the offending key(s) and exits non-zero, the same shape as
// services/web/scripts/check-messages.mjs without reusing its code (NFR-7: no service is
// touched by this feature).
//
// A handful of placeholders are not prose at all — they are computed per locale instead of
// authored twice (plan.md's "Approach", third paragraph): {{base}} (empty at the root, "../"
// under es/), the head/hreflang/canonical block built off the one SITE_URL constant below, and
// {{detect}} — the root's browser-sniffing redirect script versus /es/'s override-only variant
// that never sniffs. These live in COMPUTED_KEYS and are never read from a catalog file, and a
// catalog is never allowed to define one of these names either (084's T003).
//
// Run through bin/site (Article I) — never directly on the host.

import { mkdirSync, readFileSync, writeFileSync, createReadStream, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

// The one constant canonical/og:url/hreflang are built from (plan.md's Risks: "SITE_URL
// drifts"). Changing the published domain means editing this one line.
const SITE_URL = "https://dientuki.github.io/perceptor/";
const EN_URL = SITE_URL;
const ES_URL = `${SITE_URL}es/`;

// Reciprocal hreflang: both documents declare the same three alternates (REQ-4). x-default
// points at the root, same as the English alternate.
const HREFLANG_BLOCK = [
  `<link rel="alternate" hreflang="en" href="${EN_URL}">`,
  `<link rel="alternate" hreflang="es" href="${ES_URL}">`,
  `<link rel="alternate" hreflang="x-default" href="${EN_URL}">`,
].join("\n");

// The storage key the detect scripts read/write. A single literal shared by both variants
// below — never a catalog value, since it is never shown to anyone.
const STORE_KEY = "perceptor-lang";

// The root (en) variant: an explicit `?lang=` wins first (recorded and, for `es`, redirected);
// an unrecognized value (e.g. `fr`) is ignored outright — no record, no redirect, AC-7 — and
// falls through to the stored preference, and only then to the browser's own first preferred
// language, which is never recorded (REQ-7) so a preference nobody expressed is never frozen.
// Every storage access is wrapped so a throw (private mode, blocked site data) degrades to "act
// as if nothing was stored" rather than breaking the page (NFR-9).
const DETECT_EN = `<script>
(function () {
  function getStored() { try { return localStorage.getItem('${STORE_KEY}'); } catch (e) { return null; } }
  function setStored(v) { try { localStorage.setItem('${STORE_KEY}', v); } catch (e) {} }
  var params = null;
  try { params = new URLSearchParams(location.search); } catch (e) {}
  var explicit = params ? params.get('lang') : null;
  if (explicit === 'es') { setStored('es'); location.replace('es/'); return; }
  if (explicit === 'en') {
    setStored('en');
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    return;
  }
  // An explicit but unrecognized ?lang= (e.g. "fr") is ignored outright: no record, no
  // redirect, fall through as if it had never been there (AC-7).
  var stored = getStored();
  if (stored === 'es') { location.replace('es/'); return; }
  if (stored === 'en') { return; }
  var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
  var first = (langs[0] || '').toLowerCase();
  if (first.indexOf('es') === 0) { location.replace('es/'); }
})();
</script>`;

// The /es/ variant: only an explicit \`?lang=en\` is handled, and it is the only thing that can
// move a visitor off this page. It never reads navigator.language — arriving here is already a
// statement of intent (REQ-6's commentary), so there is nothing to sniff.
const DETECT_ES = `<script>
(function () {
  function setStored(v) { try { localStorage.setItem('${STORE_KEY}', v); } catch (e) {} }
  var params = null;
  try { params = new URLSearchParams(location.search); } catch (e) {}
  var explicit = params ? params.get('lang') : null;
  if (explicit === 'en') { setStored('en'); location.replace('../'); return; }
  if (explicit === 'es') {
    setStored('es');
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  }
})();
</script>`;

// One entry per published document. Everything here is computed, never translated — the
// prose each document needs comes from tools/site/<locale>.json instead.
const LOCALES = [
  {
    locale: "en",
    outFile: path.join(repoRoot, "site", "index.html"),
    lang: "en",
    base: "",
    canonicalUrl: EN_URL,
    ogLocale: "en_US",
    // The switcher's own href: a plain link (works with no JS, REQ-5) that also carries the
    // ?lang= marker the target page's detect script reads to tell "I was explicitly clicked
    // here" apart from "I was auto-redirected here" (REQ-7 vs REQ-6).
    otherLocaleUrl: "es/?lang=es",
    detect: DETECT_EN,
  },
  {
    locale: "es",
    outFile: path.join(repoRoot, "site", "es", "index.html"),
    lang: "es",
    base: "../",
    canonicalUrl: ES_URL,
    ogLocale: "es_AR",
    otherLocaleUrl: "../?lang=en",
    detect: DETECT_ES,
  },
];

// Placeholder names the generator fills in itself. A catalog must never define one of these —
// it would be silently shadowed, so a mistaken catalog key here is still caught as "unused in
// catalog" below, since prosedKeys excludes these names entirely.
const COMPUTED_KEYS = new Set(["lang", "base", "canonicalUrl", "hreflangBlock", "ogLocale", "otherLocaleUrl", "detect"]);

const templatePath = path.join(here, "template.html");
const template = readFileSync(templatePath, "utf8");

const placeholderRe = /\{\{([a-zA-Z0-9_.]+)\}\}/g;
const templateKeys = new Set();
for (const match of template.matchAll(placeholderRe)) {
  templateKeys.add(match[1]);
}
const prosedKeys = new Set([...templateKeys].filter((key) => !COMPUTED_KEYS.has(key)));

let hadError = false;

for (const loc of LOCALES) {
  const { locale, outFile } = loc;
  const catalogPath = path.join(here, `${locale}.json`);
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const catalogKeys = new Set(Object.keys(catalog));

  const missing = [...prosedKeys].filter((key) => !catalogKeys.has(key)).sort();
  const unused = [...catalogKeys].filter((key) => !prosedKeys.has(key)).sort();

  if (missing.length > 0) {
    hadError = true;
    console.error(`[${locale}] missing from catalog (used in template but no entry):`);
    for (const key of missing) console.error(`  ${key}`);
  }
  if (unused.length > 0) {
    hadError = true;
    console.error(`[${locale}] unused in catalog (no {{key}} in template):`);
    for (const key of unused) console.error(`  ${key}`);
  }
  if (missing.length > 0 || unused.length > 0) continue;

  const computed = {
    lang: loc.lang,
    base: loc.base,
    canonicalUrl: loc.canonicalUrl,
    hreflangBlock: HREFLANG_BLOCK,
    ogLocale: loc.ogLocale,
    otherLocaleUrl: loc.otherLocaleUrl,
    detect: loc.detect,
  };

  const rendered = template.replace(placeholderRe, (_, key) =>
    COMPUTED_KEYS.has(key) ? computed[key] : catalog[key],
  );

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, rendered, "utf8");
  console.log(`[${locale}] wrote ${path.relative(repoRoot, outFile)} (${catalogKeys.size} keys)`);
}

if (hadError) {
  process.exit(1);
}

// --serve: a static file server over site/, with no dependency (NFR-2), used only to give the
// browser pass a real http:// origin (plan.md's Verification — detection, storage and the
// relative-path criteria all need one, file:// does not provide it). Regeneration above always
// runs first, so --serve reflects whatever the catalogs/template currently say.
if (process.argv.includes("--serve")) {
  const siteRoot = path.join(repoRoot, "site");
  const PORT = Number(process.env.SITE_SERVE_PORT) || 8089;

  const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  };

  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath.endsWith("/")) urlPath += "index.html";

    const filePath = path.normalize(path.join(siteRoot, urlPath));
    // Refuse anything that escapes site/ (a defensive check, not a real threat model here —
    // this server only ever runs locally for the browser pass).
    if (!filePath.startsWith(siteRoot)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found: " + urlPath);
      return;
    }

    if (stat.isDirectory()) {
      res.writeHead(302, { Location: urlPath.endsWith("/") ? urlPath + "index.html" : urlPath + "/" });
      res.end();
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  });

  server.listen(PORT, () => {
    console.log(`[serve] http://localhost:${PORT}/ and http://localhost:${PORT}/es/`);
  });
}
