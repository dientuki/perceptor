#!/usr/bin/env node
// Defends the Spanish detector and the REQ-1 reference parser in check.mjs (NFR-5): a detector
// that drifts broad fails an honest English comment and the gate gets disabled rather than fixed;
// one that drifts narrow passes real Spanish prose under a green check and the debt this feature
// exists to close silently regrows. Neither failure shows up any other way — there is no type
// error, no test suite elsewhere, and a reviewer skimming a 700-line comment-sweep diff will not
// notice one Spanish sentence slipping past a check that is supposed to catch exactly that.
//
// Plain node-runnable fixture script — there is no test runner at the repo root (tools/ has never
// had a suite). Run with `node tools/comments/check.spec.mjs`, or through bin/comments' own image
// via `bin/cli web node tools/comments/check.spec.mjs`.

import { isSpanishText, stripQuotedRuns, validateReferenceText } from "./check.mjs";

let hadFailure = false;
let passCount = 0;

function expect(name, actual, expected) {
  if (actual !== expected) {
    console.error(`FAIL: ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    hadFailure = true;
  } else {
    passCount++;
  }
}

// --- Spanish detector fixtures ---------------------------------------------------------------

// Verbatim, the two real lines the detector must NOT flag (plan.md's named risk row 3): English
// Article IX test headers that quote Spanish user-facing copy.
const AUTH_ERROR_KEYS_HEADER =
  "The regression this whole suite exists to catch: every site that used to " +
  "throw the plain-string 'No autenticado' or 'Tu sesión expiró, iniciá " +
  "sesión de nuevo' must resolve to exactly one of these two constants. If a " +
  "future edit renamed or repointed either constant, every case above would " +
  "fail, not just an assertion that a constant equals itself.";

const LANGUAGES_SERVICE_HEADER =
  "This suite exists because `findTrackTitles()` collapses three rows sharing " +
  "one `iso3` (a base language plus its regional variants) down to a single " +
  "entry, and the rule for which row survives is easy to get backwards: if a " +
  "variant row won instead of the base row, the worker would still get one " +
  "entry per `iso3` — nothing would throw, the count would still look right — " +
  "but a title using `es-419`'s or `es-ES`'s bare row would render whichever " +
  "variant happened to be seeded last instead of the intended `Español`, with " +
  "no error anywhere to catch it.";

expect(
  "auth-error-keys.spec.ts:213's English header quoting Spanish copy passes",
  isSpanishText(AUTH_ERROR_KEYS_HEADER),
  false,
);

expect(
  "languages.service.spec.ts:360's English prose quoting 'Español' passes",
  isSpanishText(LANGUAGES_SERVICE_HEADER),
  false,
);

expect(
  "a plain Spanish comment is flagged",
  isSpanishText("Esto arranca el encode cuando el torrent ya bajó, nunca antes."),
  true,
);

expect(
  "a comment made only of ambiguous English-also words passes",
  isSpanishText("no, la, son, si, me, van, ten"),
  false,
);

expect(
  "an ordinary English comment with no Spanish passes",
  isSpanishText("the guard runs before the first write"),
  false,
);

expect(
  "stripQuotedRuns removes a single-quoted run",
  stripQuotedRuns("throws 'No autenticado' on failure"),
  "throws   on failure",
);

// --- Reference grammar fixtures ---------------------------------------------------------------

expect(
  "a comment with no reference token at all is not a reference violation",
  validateReferenceText("the guard runs before the first write", { exceptionContext: false }).kind,
  "none",
);

expect(
  "a well-formed single-spec locator resolves",
  validateReferenceText("Spec 047, REQ-10", { exceptionContext: false }).kind,
  "ok",
);

expect(
  "a well-formed two-spec locator resolves",
  validateReferenceText("Spec 010, NFR-1; Spec 006, NFR-1b", { exceptionContext: false }).kind,
  "ok",
);

expect(
  "a slug-qualified ad-hoc reference is malformed (AC-5)",
  validateReferenceText("per 018-ui-i18n REQ-7, the key survives", { exceptionContext: false }).kind,
  "malformed",
);

expect(
  "a parenthesised bare reference is malformed",
  validateReferenceText("Idle installation: zero TMDB calls (NFR-2, AC-4)", { exceptionContext: false }).kind,
  "malformed",
);

expect(
  "a locator with prose around it is malformed outside an exception context",
  validateReferenceText("Containment check for a path (047-source-deletion REQ-10): see above", {
    exceptionContext: false,
  }).kind,
  "malformed",
);

expect(
  "the same inline reference is legal inside an exception context, once properly spelled",
  validateReferenceText("Containment check for a path (Spec 047, REQ-10): see above", {
    exceptionContext: true,
  }).kind,
  "ok",
);

expect(
  "an exception context does not excuse a badly-spelled reference inside it",
  validateReferenceText("Containment check for a path (047 REQ-10): see above", {
    exceptionContext: true,
  }).kind,
  "malformed",
);

// --- Prove the fixtures actually exercise the quote-stripping rule -----------------------------
//
// If tools/comments/check.mjs's stripQuotedRuns call inside isSpanishText were ever commented
// out, these two fixtures must flip to failing — that is what proves this file tests the rule
// rather than merely restating it.
if (stripQuotedRuns("'No autenticado'") === "'No autenticado'") {
  console.error(
    "FAIL: quote-stripping-is-live — stripQuotedRuns no longer strips a quoted run; " +
      "the two named Article IX headers would start failing the gate.",
  );
  hadFailure = true;
} else {
  passCount++;
}

if (hadFailure) {
  console.error(`\ncheck.spec.mjs: FAIL (${passCount} passed)`);
  process.exit(1);
}

console.log(`check.spec.mjs: PASS (${passCount} assertions)`);
