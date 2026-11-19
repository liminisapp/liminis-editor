# Feature Specification: Replace ESLint with Oxlint (type-aware) and move to TypeScript 7

**Feature Branch**: `fabrik/issue-209`
**Created**: 2026-11-18
**Status**: Specified
**Input**: User description: "## Goal

Replace ESLint + typescript-eslint with **Oxlint** (type-aware, via `oxlint-tsgolint`), and move the package to **TypeScript 7**. typescript-eslint is the only thing holding the editor on TypeScript 6.

## Why

- `typescript-eslint` (latest 8.x) declares `typescript: >=4.8.4 <6.1.0`, and under TypeScript 7 ESLint crashes with *\"typescript-eslint does not support TS 7.0\"* (typescript-eslint/typescript-eslint#10940). Because of this, Dependabot closed #168 (TypeScript 6.0.3 → 7.0.2) as \"no longer updatable\".
- Oxlint's type-aware mode went stable on 2026-07-22 ([announcement](https://oxc.rs/blog/2026-07-22-type-aware-linting-stable)). tsgolint v7 is built directly on TypeScript 7 (it tracks 7.0.2), covers 59 of typescript-eslint's 61 type-aware rules, and the announcement reports it as 12–18× faster.

## Evidence from a local trial (2026-11-18, nothing committed)

Trial on `main` at 0.8.0 with Oxlint 1.94.0 and `oxlint-tsgolint` 7.0.2007:

- **Config conversion.** `npx @oxlint/migrate --type-aware --with-nursery eslint.config.js` produced a `.oxlintrc.json` with **128 rules**.
  - It carried over the `no-restricted-globals`, `no-restricted-properties` and `no-restricted-imports` configurations, messages included.
  - It skipped 5 rules. Only one matters: `no-restricted-syntax` (not implemented). The other four:
    - `no-dupe-args` and `no-octal` are superseded by strict mode.
    - `react-hooks/config` and `react-hooks/gating` are React Compiler options that Oxlint fixes.
- **Results on `src/` and `tests/` (193 files):**
  - `oxlint --type-aware` reports exactly the same result as ESLint: one warning, `react(only-export-components)` in `src/host/context.tsx`.
  - Oxlint took **0.43 s**; ESLint took 7.3 s.
- **Rule probe.** A file seeded with known bugs, run through Oxlint. It caught all of them:
  - Floating promises, both local and imported (`no-floating-promises`).
  - A promise in a conditional, and an async callback passed to `forEach` (`no-misused-promises`).
  - Unnecessary `as number` and an unnecessary `!` (`no-unnecessary-type-assertion`, the rule that once failed a publish after tagging).
  - `confirm()` (`no-restricted-globals`, with the custom message).
- **TypeScript 7.0.2 in the trial worktree:**
  - typecheck: 0 errors, 0.6 s
  - `verify:package`: all checks pass
  - `pnpm test`: 1896 passed, 2 skipped, the same as on TypeScript 6
  - `oxlint --type-aware`: unchanged
  - ESLint: crashes, as described above
- **Biome 2.6.8 was also tried and rejected as the replacement.** It covers the promise rules, but its `noUselessTypeAssertion` misses `n as number`, and the four `no-restricted-*` rules would all need GritQL plugins. Its ~100 a11y and hooks findings, which ESLint doesn't report, are out of scope here and could be a separate follow-up.

## Scope

1. **Dependencies:**
   - Remove `eslint`, `typescript-eslint`, `@eslint/js`, `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh`, plus anything else that exists only for ESLint.
   - Add `oxlint` and `oxlint-tsgolint`.
   - Bump `typescript` to `^7.0.2`.
2. **Config:**
   - Add `.oxlintrc.json`, generated with `@oxlint/migrate` and then reviewed by hand, with `options.typeAware: true`.
   - Keep the per-file overrides and `ignores` equivalent to `eslint.config.js`.
   - Delete `eslint.config.js`.
3. **Scripts:**
   - `lint` becomes `oxlint --type-aware src/ tests/`.
   - `lint:fix` becomes the same command with `--fix`.
   - Keep `--max-warnings` behaviour equivalent to today's.
   - CI (`ci.yml`) and `publish.yml` already call `pnpm lint`, so they should not need changes. Verify that the publish job's lint step works with the Oxlint binary under the pinned node 24 / npm 12.0.2.
4. **`no-restricted-syntax` (the ADR-075 host-boundary guard) must keep working.** ESLint currently enforces three selectors that stop `@liminis/editor` from reaching the host through:
   - `window.api` / `globalThis.api`
   - `window['api']`
   - `(window as …).api`

   Oxlint has no `no-restricted-syntax`. Preferred fix: a small Oxlint **JS plugin** (Oxlint's ESLint-compatible `jsPlugins`), kept in the repo, that reports the same three patterns with the same messages. If that turns out impractical, document the alternative chosen and why. Do not drop the guard silently. Add a test, fixture or probe that proves each of the three patterns still fails lint.
5. **Dependabot.** tsgolint versions track a specific TypeScript release, so group `oxlint`, `oxlint-tsgolint` and `typescript` so they move together. Remove any ESLint groups.
6. **Docs:**
   - Update any README, CONTRIBUTING or ADR text that names ESLint or typescript-eslint as the linter.
   - Record the decision in an ADR, including the `no-restricted-syntax` approach and why Oxlint was chosen over Biome.
   - Add a CHANGELOG entry under `## Unreleased`, dev-only with no consumer-facing change. TypeScript 7 is a devDependency here, so there is no peer-range change for consumers. Confirm that.

## Acceptance criteria

- `pnpm lint` runs Oxlint type-aware and reports no new findings compared with the current ESLint baseline: one `only-export-components` warning.
- The rule probe above (floating/misused promises, unnecessary assertions, `confirm()`) fails lint under the new setup. Each of the three ADR-075 `window.api` patterns also fails lint with its message.
- `typescript` is `^7.0.2`, and typecheck, test, `verify:package` and `build:examples` pass on it. All CI jobs are green.
- No ESLint packages or config remain.
- The publishable package is unchanged in content: `verify:package` passes, and the emitted `.d.ts` files still work for consumers on TypeScript 6. Check this explicitly, since consumers may not be on TypeScript 7 yet.

## Out of scope

- Biome adoption and fixing its a11y/hooks findings (possible separate issue).
- The demo's `useScrollSync` jump after a C4 drop."

## Background

`typescript-eslint` caps its supported TypeScript range below 7, and under TypeScript 7 ESLint crashes outright (typescript-eslint#10940). That makes the linter the only thing keeping `@liminis/editor` on TypeScript 6, and it is why Dependabot closed #168 (TypeScript 6.0.3 → 7.0.2) as "no longer updatable". Oxlint's type-aware mode (via `oxlint-tsgolint`, built on TypeScript 7) went stable on 2026-07-22, covers 59 of typescript-eslint's 61 type-aware rules, and is reported as 12–18× faster.

A local trial on 0.8.0 (nothing committed) showed the move is feasible:

- `@oxlint/migrate` converted the ESLint config to 128 Oxlint rules, carrying over the `no-restricted-globals`, `no-restricted-properties` and `no-restricted-imports` configurations with their messages. It skipped five rules. Four don't matter: `no-dupe-args` and `no-octal` are superseded by strict mode, and `react-hooks/config` and `react-hooks/gating` are React Compiler options Oxlint fixes. The fifth, **`no-restricted-syntax`**, has no Oxlint equivalent and backs the ADR-075 host-boundary guard (three selectors that stop the package reaching the host through `window.api`, `window['api']`, or `(window as …).api`).
- On `src/` and `tests/` (193 files) type-aware Oxlint reports exactly ESLint's result — one `react(only-export-components)` warning in `src/host/context.tsx` — in 0.43 s versus 7.3 s.
- A seeded-bug probe was caught in full: floating promises (local and imported), misused promises (conditional, async `forEach` callback), unnecessary `as number` and `!` (the rule that once failed a publish after tagging), and `confirm()` with its custom message.
- TypeScript 7.0.2 in the trial: typecheck 0 errors (0.6 s), `verify:package` passes, `pnpm test` 1896 passed / 2 skipped (same as TypeScript 6), Oxlint unchanged; ESLint crashes.
- Biome 2.6.8 was tried and rejected: its `noUselessTypeAssertion` misses `n as number`, and the four `no-restricted-*` rules would each need GritQL plugins. Its ~100 a11y/hooks findings are out of scope.

Repository facts checked while specifying: `package.json` is at 0.8.0 (shipped) and `typescript` is a devDependency only, not a peer dependency; `.github/workflows/ci.yml` and `publish.yml` each run `pnpm lint`; the current `lint` script passes no `--max-warnings`; `examples/external-consumer` pins `typescript ^6.0.3`; the README names `eslint src/ tests/` in its development commands; `docs/decisions/adr-024.md` mentions an ESLint rule as a checklist item; `.github/dependabot.yml` has no ESLint-specific group today (ESLint packages fall into `dev-non-major` and `majors`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Lint passes on Oxlint with no loss of coverage (Priority: P1)

A maintainer runs `pnpm lint` and gets type-aware Oxlint results equal to today's ESLint baseline, with every currently enforced rule class still enforced.

**Why this priority**: This is the core replacement. Without it, nothing else (TypeScript 7) can land.

**Independent Test**: Run `pnpm lint` on a clean checkout; compare with the ESLint baseline. Run it against a seeded-bug probe file and confirm each bug is reported.

**Acceptance Scenarios**:

1. **Given** a clean checkout of the branch, **When** `pnpm lint` runs, **Then** it exits successfully and reports exactly one warning, `react(only-export-components)` in `src/host/context.tsx`, and nothing else.
2. **Given** a probe file with a floating promise (local and imported), a promise in a conditional, an async callback passed to `forEach`, an unnecessary `as number`, an unnecessary `!`, and a bare `confirm()` call, **When** lint runs on it, **Then** each of those is reported, and `confirm()` carries the project's custom message.
3. **Given** the per-file overrides and ignores in `eslint.config.js` (including the plain-Node build tooling and `examples/**` exclusions), **When** lint runs, **Then** the same files are linted and the same files are skipped as before.

---

### User Story 2 - The ADR-075 host-boundary guard still fails lint (Priority: P1)

A contributor who reaches the host through `window.api` in any of the three spellings gets a lint error with the ADR-075 guidance, exactly as under ESLint.

**Why this priority**: The guard is an architectural boundary. Dropping it silently would reopen a regression path the package deliberately closed; it is as important as the replacement itself.

**Independent Test**: A committed test, fixture or probe that feeds each of the three patterns to lint and asserts failure with the expected message, and feeds near-miss innocent code and asserts no failure.

**Acceptance Scenarios**:

1. **Given** code containing `window.api`, `window?.api` or `globalThis.api`, **When** lint runs, **Then** it fails with the dotted-form message citing ADR-075.
2. **Given** code containing `window['api']` or `window?.['api']`, **When** lint runs, **Then** it fails with the computed-form message.
3. **Given** code containing `(window as unknown as { api: … }).api` (or a single `as`, or the computed spelling), **When** lint runs, **Then** it fails with the cast-form message.
4. **Given** code such as `(someService as unknown as { api: Client }).api`, **When** lint runs, **Then** it is not reported.
5. **Given** the chosen mechanism (a repo-local Oxlint JS plugin is preferred; any alternative must be documented with reasons), **When** a maintainer reads the ADR, **Then** the approach and the reason for it are recorded.

---

### User Story 3 - The package builds, tests and publishes on TypeScript 7 (Priority: P1)

The package's `typescript` devDependency moves to `^7.0.2` and every pipeline job stays green, including the publish job's lint step under the pinned Node 24 / npm 12.0.2.

**Why this priority**: Unblocking TypeScript 7 is the reason for the whole issue.

**Independent Test**: Run typecheck, `pnpm test`, `verify:package`, `build:examples` and `pnpm lint` on the branch, and confirm CI is green.

**Acceptance Scenarios**:

1. **Given** `typescript ^7.0.2`, **When** typecheck, tests, `verify:package` and `build:examples` run, **Then** all pass with test counts equal to the TypeScript 6 baseline.
2. **Given** the publish workflow's pinned Node 24 / npm 12.0.2, **When** its lint step runs, **Then** the Oxlint binary and tsgolint resolve and run successfully.
3. **Given** the emitted `.d.ts` files, **When** a consumer on TypeScript 6 type-checks against the packed package (as `examples/external-consumer`, which pins TypeScript 6, can), **Then** it compiles without error.

---

### User Story 4 - Tooling updates move together; no ESLint remains (Priority: P2)

Dependabot proposes `oxlint`, `oxlint-tsgolint` and `typescript` updates as one group, and nothing in the repository still refers to ESLint as the linter.

**Why this priority**: tsgolint tracks a specific TypeScript release, so split PRs would each fail on the other's absence (same failure mode as the vitest group, #167). Cleanup is necessary but doesn't change behaviour.

**Independent Test**: Inspect `.github/dependabot.yml`, `package.json`, the lockfile, and a repository-wide search for ESLint references.

**Acceptance Scenarios**:

1. **Given** the Dependabot config, **When** read, **Then** one group covers `oxlint`, `oxlint-tsgolint` and `typescript`, and it takes precedence over the generic `dev-non-major` and `majors` groups for those packages.
2. **Given** the repository, **When** searched for ESLint packages and config, **Then** none remain in manifests, lockfile, or config files, and docs name Oxlint where they name the linter.

---

### User Story 5 - The decision is recorded and the change is correctly released (Priority: P2)

A future maintainer can read an ADR to learn why Oxlint over Biome, how the `window.api` guard is kept, and what the change costs; consumers see no change.

**Why this priority**: The repository's conventions require ADRs for decisions and a CHANGELOG entry per change.

**Independent Test**: Read the ADR and CHANGELOG; confirm naming and header conventions from `CLAUDE.md`.

**Acceptance Scenarios**:

1. **Given** the ADR, **When** read, **Then** it is named `adr-209-<slug>.md`, carries the required header (`Issue: #209 (verveguy/liminis-editor)` and the rest), and records the Oxlint-over-Biome reasoning, the guard approach, and the costs (the 2 typescript-eslint rules without a tsgolint equivalent, the config surface the migration skipped, and dependence on a young type-aware toolchain).
2. **Given** the CHANGELOG, **When** read, **Then** a dev-only entry sits under `## Unreleased` (no version heading, no version bump) stating there is no consumer-facing change.
3. **Given** `package.json` peer dependencies, **When** compared with 0.8.0, **Then** they are unchanged, confirming TypeScript 7 creates no peer-range change.

---

### Edge Cases

- Existing `eslint-disable` comments in `src/` must keep working or be migrated; none may start failing lint or be silently left as dead directives that hide a finding.
- The ESLint config documents that plain-Node build scripts sit outside the TypeScript project and are ignored because the type-aware parser can't resolve them; the Oxlint ignores must preserve that, or type-aware linting of them must demonstrably work.
- Rules ESLint enforced as errors versus warnings must keep their severities, notably the ADR-075 guard (error) versus the browser-dialog restrictions (warnings).
- Oxlint/tsgolint reporting an additional finding that ESLint didn't: it must be fixed or the rule consciously turned off with a recorded reason, not left to fail CI unexplained.
- The 2 typescript-eslint type-aware rules without a tsgolint equivalent, and the one `no-restricted-syntax` rule, are the only known coverage gaps; any other rule found missing during review must be called out in the ADR.
- A guard test must fail if the guard is accidentally disabled (e.g. a plugin path that no longer resolves must not degrade to "no findings").

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `pnpm lint` runs Oxlint in type-aware mode over `src/` and `tests/`, and `pnpm lint:fix` runs the same with `--fix`.
- **FR-002**: Lint on a clean tree reports no findings beyond the current baseline (one `react(only-export-components)` warning in `src/host/context.tsx`).
- **FR-003**: Oxlint configuration lives in `.oxlintrc.json` with type-aware linting enabled, generated by `@oxlint/migrate` and reviewed by hand, preserving the existing rule set, severities, per-file overrides and ignores from `eslint.config.js`.
- **FR-004**: The `no-restricted-globals`, `no-restricted-properties` and `no-restricted-imports` configurations (including custom messages) are preserved.
- **FR-005**: The three ADR-075 patterns (dotted/optional, computed, and cast `window`/`globalThis` access to `api`) each fail lint with a message equivalent to today's, and the cast form does not report casts of unrelated objects.
- **FR-006**: The ADR-075 guard is implemented as a repo-local Oxlint JS plugin if practical; if not, the chosen alternative and the reasons are documented. The guard is never dropped.
- **FR-007**: A committed, automated check proves each of the three patterns fails lint and that innocent near-misses do not, and it fails if the guard stops loading.
- **FR-008**: Lint behaviour regarding warnings matches today's: warnings are reported but do not fail the run (the current script sets no `--max-warnings`), unless a deliberate change is recorded in the ADR.
- **FR-009**: `eslint`, `typescript-eslint`, `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, any other ESLint-only dependency, and `eslint.config.js` are removed; `oxlint` and `oxlint-tsgolint` are added; the lockfile is updated accordingly.
- **FR-010**: `typescript` is `^7.0.2`, and typecheck, tests, `verify:package` and `build:examples` pass with it.
- **FR-011**: `ci.yml` and `publish.yml` continue to run `pnpm lint` and pass; the publish job's lint step is verified to work under the pinned Node 24 / npm 12.0.2.
- **FR-012**: The emitted `.d.ts` files are verified to be consumable by a TypeScript 6 consumer, and the published package contents are unchanged other than as a result of the toolchain bump (`verify:package` passes).
- **FR-013**: Dependabot groups `oxlint`, `oxlint-tsgolint` and `typescript` into one group that takes precedence over the generic groups, and carries a comment explaining why; any ESLint-specific grouping is removed.
- **FR-014**: Documentation that names ESLint or typescript-eslint as the linter (README development commands, comments in docs and configs) is updated; historical records are amended, not rewritten, per the repository's ADR rules (e.g. the ADR-024 checklist item is left as history or gets a dated amendment note).
- **FR-015**: A new ADR named `adr-209-<slug>.md` with the required header records the decision, including the `no-restricted-syntax` approach, why Oxlint was chosen over Biome, and what the move costs.
- **FR-016**: A dev-only CHANGELOG entry is added under `## Unreleased`; `package.json`'s version is not bumped; peer dependencies are unchanged, and the entry states TypeScript 7 introduces no consumer-facing peer-range change.

### Key Entities *(if applicable)*

- **ADR-075 host-boundary guard**: the lint rule set that forbids reaching the host through `window.api`/`globalThis.api` in dotted, computed and cast forms.
- **Lint baseline**: the current ESLint result on `src/` and `tests/` — a single `only-export-components` warning — against which the new setup is compared.
- **Toolchain group**: `oxlint`, `oxlint-tsgolint` and `typescript`, whose versions must advance together.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `pnpm lint` exits 0 on the branch and reports exactly one finding, matching the baseline warning.
- **SC-002**: 100% of the seeded probe bugs (6 categories listed in User Story 1) and all 3 ADR-075 patterns are reported by lint, each with the expected rule and message.
- **SC-003**: Typecheck, `pnpm test` (1896 passed, 2 skipped, same as the TypeScript 6 baseline), `verify:package` and `build:examples` pass on TypeScript 7.0.x, and all CI jobs are green.
- **SC-004**: A TypeScript 6 consumer compiles against the packed package's `.d.ts` files with zero errors.
- **SC-005**: A repository-wide search finds no ESLint package, config file, or "linter is ESLint" wording outside historical records and the ADR/CHANGELOG.
- **SC-006**: A full lint run is no slower than the ESLint run it replaces (trial: 0.43 s versus 7.3 s).

## Assumptions

- Today's `lint` script sets no `--max-warnings`, so "equivalent behaviour" means warnings do not fail the run. If review finds a different intent, the ADR records the change.
- The release is a patch (or accumulates under `## Unreleased`): this is dev-only and additive in effect, and `0.8.0` has already shipped, so no version bump happens in this issue.
- `examples/external-consumer` (which pins TypeScript 6) can serve as the TypeScript 6 consumer check; whether it also moves to TypeScript 7 is a plan-stage choice, as long as a TypeScript 6 consumption check exists.
- Oxlint, `oxlint-tsgolint` and `typescript` versions are the trial's (Oxlint ≥ 1.94, tsgolint 7.0.x tracking TypeScript 7.0.2) or the latest compatible at implementation time.
- The 2 typescript-eslint type-aware rules without a tsgolint equivalent are not relied on by this codebase (the trial showed no behaviour difference); the ADR names them.
- The `examples/**` ignore and plain-Node scripts exclusion carry over unchanged.
- Existing ADRs are not renumbered or rewritten; the new ADR follows the issue-number naming convention.

## Out of Scope *(optional)*

- Biome adoption and fixing its ~100 a11y/hooks findings (a possible separate issue).
- The demo's `useScrollSync` jump after a C4 drop.
- Enabling additional Oxlint rule categories beyond the migrated set (new findings that ESLint did not report).
- Any change to the published package's runtime behaviour, public API or peer ranges.

## Source References *(optional)*

- typescript-eslint/typescript-eslint#10940 — typescript-eslint does not support TS 7.0
- Oxlint type-aware linting stable announcement: https://oxc.rs/blog/2026-07-22-type-aware-linting-stable
- #168 — Dependabot TypeScript 6.0.3 → 7.0.2, closed as no longer updatable
- #167 — vitest grouping rationale (split grouped tooling fails on the other's absence)
- ADR-075 — host boundary; ADR-078 — publishing; `CLAUDE.md` — ADR naming/header and release conventions
