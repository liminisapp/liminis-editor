# ADR-209: Lint with Type-Aware Oxlint, Which Frees the Package to Move to TypeScript 7

**Date:** 2026-11-18
**Status:** Accepted
**Supersedes:** none
**Amends:** none
**Issue:** #209 (verveguy/liminis-editor)

## Context

`typescript-eslint` was the only thing holding the package on TypeScript 6. Its
latest 8.x declares `typescript: >=4.8.4 <6.1.0`, and under TypeScript 7 ESLint
crashes with "typescript-eslint does not support TS 7.0"
(typescript-eslint/typescript-eslint#10940). Dependabot closed #168
(TypeScript 6.0.3 → 7.0.2) as "no longer updatable" for that reason.

Oxlint's type-aware mode went stable on 2026-07-22. It runs through
`oxlint-tsgolint`, which is built directly on TypeScript 7.

## Decision

1. **Replace ESLint with Oxlint in type-aware mode.** `eslint`,
   `typescript-eslint`, `@eslint/js`, `eslint-plugin-react-hooks`,
   `eslint-plugin-react-refresh` and `globals` (which only `eslint.config.js`
   used) are removed. `oxlint` and `oxlint-tsgolint` are added.
   `eslint.config.js` is replaced by `.oxlintrc.json`.
2. **Move `typescript` to `^7.0.2`.** It is a devDependency only; the peer
   dependencies are unchanged from 0.8.0 (Lexical and React), so consumers see no
   peer-range change.
3. **Keep the ADR-075 guard as a repo-local Oxlint JS plugin**
   (`lint/adr-075-host-boundary.mjs`, rule `adr-075/host-boundary`, error).
4. **Group `oxlint`, `oxlint-tsgolint` and `typescript` in Dependabot**, ahead of
   the generic groups.
5. **Leave `lint` without `--max-warnings`**, as it was. Warnings are reported
   and do not fail the run; the baseline is one
   `react(only-export-components)` warning in `src/host/context.tsx`.

### How the configuration was produced

`npx @oxlint/migrate --type-aware --with-nursery eslint.config.js` generated 128
rules. It was then pruned by hand to the old effective rule set: nothing the old
config did not enable is enabled, and the rules it turned off stay off. The
`no-restricted-globals`, `no-restricted-properties` and `no-restricted-imports`
configurations came across with their messages. Severities were checked against
the old config: `no-restricted-imports`, the ADR-075 guard, `no-misused-promises`
(with `checksVoidReturn.attributes: false`) and `no-unused-vars` are errors;
the browser-dialog restrictions, `no-floating-promises` and
`only-export-components` are warnings. `.oxlintrc.json` is read as JSONC, so the
rationale comments from `eslint.config.js` travel with it.

### The `no-restricted-syntax` replacement

ESLint enforced the ADR-075 host boundary with three `no-restricted-syntax`
selectors: dotted (`window.api`, `window?.api`, `globalThis.api`), computed
(`window['api']`) and cast (`(window as unknown as {…}).api`). Oxlint has no
`no-restricted-syntax`. The guard is now one `MemberExpression` visitor in a
repo-local JS plugin that reports the same three cases with the same three
messages. The cast case is anchored on the cast *operand* (`window` one or two
`as` levels down), so `(someService as unknown as { api: Client }).api` is not
reported.

**Alternative considered: `oxlint-plugin-eslint`**, which packages ESLint's
built-in rules as a JS plugin and would have let the selectors be copied
verbatim. Not chosen: it is one more young alpha-era dependency, whether its
`no-restricted-syntax` accepts the full esquery syntax used by the cast selector
(`:matches`, nested attribute paths) was unconfirmed, and the hand-written
anchoring is about 40 lines that are fully testable.

`tests/adr-075-guard.test.ts` spawns the real `oxlint` binary against the real
`.oxlintrc.json`. It asserts rule, message and severity for each form, asserts
that near-misses (`foo.api`, `window.apiKey`, `window['other']`,
`(svc as unknown as {…}).api`) are not reported, and pairs every "clean" result
with a "must report" result in the same run so a guard that does not load cannot
pass as clean. It also runs a type-aware probe of seeded bugs (floating promises
local and imported, promises in a conditional and an async `forEach` callback,
unnecessary `as number` and `!`, bare `confirm()`).

**A missing plugin fails loudly.** Pointing `jsPlugins` at a path that does not
resolve makes Oxlint exit non-zero with "Failed to load JS plugin". It does not
degrade to "no findings", and the test asserts that.

### Why Oxlint rather than Biome

Biome 2.6.8 was tried and rejected. Its `noUselessTypeAssertion` misses
`n as number`, which is the case that matters: `no-unnecessary-type-assertion`
once failed a publish after tagging (ADR-078). And the four `no-restricted-*`
rules would each need a GritQL plugin. Oxlint reproduced the ESLint result
exactly and caught every seeded bug. Biome's ~100 accessibility and hooks
findings, which ESLint does not report, are a possible separate follow-up and
are out of scope here.

### Findings from the implementation

- **`eslint-disable` comments keep working.** The ten
  `react-refresh/only-export-components` sites and the one
  `@typescript-eslint/unbound-method` site are honoured by Oxlint under those
  names. This was checked by deleting every `eslint-disable` comment: eleven
  `only-export-components` warnings and one `unbound-method` error appeared
  where there had been none. They were restored and are unchanged.
  `--report-unused-disable-directives` reports no dead directive.
- **No type-aware rule the old presets enabled is missing.** Every
  `@typescript-eslint/*` rule enabled by `recommendedTypeChecked` and
  `stylisticTypeChecked` (and not turned off in the old config) has an Oxlint
  equivalent in `.oxlintrc.json`. Comparing typescript-eslint 8.73's
  type-aware rules with `oxlint --rules` (Oxlint 1.94.0) shows three with no Oxlint
  counterpart — `naming-convention`, `no-unsafe-class-instance-assignment` and
  `prefer-destructuring` — and none was enabled here. The issue's "two rules
  without a tsgolint equivalent" does not match that count of three; the count
  is taken from the plugin as installed, and not from the issue.
- **Timing.** `pnpm lint` took about 1.5 s wall-clock on the 193 files, against
  7.3 s for ESLint in the issue's trial.
- **TypeScript 7.** Typecheck, `build`, `pnpm test` (the 1896 passed, 2 skipped
  baseline, plus the 16 new guard tests), `verify:package` and `build:examples`
  all pass. `verify:package` installed the packed tarball into
  `examples/external-consumer` and type-checked the TypeScript 7-emitted
  `.d.ts` files with that example's own TypeScript **6.0.3**, under both
  `bundler` and `nodenext` resolution and with `skipLibCheck` off.

## Consequences — what this costs

- **Alpha plugin API.** JS plugins are alpha, and their API is "not subject to
  semver". A minor Oxlint release can break the guard. Mitigations: the guard
  test fails if it stops loading or stops matching, and `oxlint` is in the
  Dependabot group, so a breaking bump arrives as one red PR.
- **Skipped configuration.** The migration skipped five entries.
  `no-restricted-syntax` is replaced by the plugin above. `no-dupe-args` and
  `no-octal` are superseded by strict mode. `react-hooks/config` and
  `react-hooks/gating` are React Compiler options that Oxlint fixes rather than
  exposes, so they can no longer be set.
- **A young type-aware toolchain, locked to TypeScript.** `oxlint-tsgolint`
  tracks a specific TypeScript release (7.0.x tracks 7.0.2). A TypeScript
  release without a matching tsgolint can now block a TypeScript update, the
  mirror image of the problem this ADR removes. That is why the three packages
  move as one Dependabot group.
- **No custom type-aware rules, no custom parsers.** Oxlint JS plugins support
  neither. The ADR-075 guard is purely syntactic and does not need them, but a
  future type-aware project rule cannot be written as a plugin.
- **A transient abnormal exit seen once.** One `pnpm lint` run on a heavily
  loaded host (load average ~14 on 28 cores) printed "Linter process terminated
  abnormally (possibly out of memory)" and then passed on every one of four
  re-runs, including with the same inputs. It was not reproduced. If it recurs in
  CI, that is the first thing to look at.
- **`examples/external-consumer` stays on TypeScript 6** deliberately. It is the
  check that the emitted declarations work for a consumer who has not moved. A
  `//typescript` note in its `package.json` says so, and Dependabot's
  `directories` do not cover it.
- **No consumer-facing change.** The published package's runtime behaviour, public
  API and peer ranges are unchanged.

## References

- ADR-075 (the host boundary the guard enforces); ADR-078 (publishing)
- ADR-024 (its checklist item names an ESLint rule; amended there)
- typescript-eslint/typescript-eslint#10940; #168 (closed Dependabot bump); #167 (vitest grouping)
- Oxlint type-aware linting stable: https://oxc.rs/blog/2026-07-22-type-aware-linting-stable
