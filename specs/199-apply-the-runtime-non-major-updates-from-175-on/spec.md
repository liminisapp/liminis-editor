# Feature Specification: Apply the runtime-non-major updates from #175 on current main and dedupe the lockfile

**Feature Branch**: `fabrik/issue-199`
**Created**: 2026-11-14
**Status**: Specified
**Input**: User description: "Issue #199: Apply the runtime-non-major updates from #175 on current main and dedupe the lockfile.

Dependabot PR #175 (runtime-non-major, 14 updates) can't merge. (1) It fails typecheck at `src/annotations/block-structure.ts(64,16): error TS2769: No overload matches this call`. The editor code is fine. The cause is two copies of `micromark-util-types` (2.0.2 and 2.0.3) in the lockfile: `micromark-extension-gfm`'s `Extension` type resolves against one, and `fromMarkdown`'s `Options` against the other. No single bump is to blame. `pnpm dedupe` on that branch makes `tsc --noEmit` clean, and only changes `pnpm-lock.yaml`. (2) It is stale. It predates #174, so its `package.json` would downgrade eslint 10.13 → 10.11, typescript-eslint 8.72.1 → 8.71.2 and tsc-alias 1.9.9 → 1.9.7. (3) It moves `mdast-util-to-markdown` 2.1.2 → 2.2.3. That package is pinned at exactly 2.1.2 on purpose (#157; the `//mdast-util-to-markdown` note in `package.json`; its own group in `.github/dependabot.yml`).

Change: Starting from current `main`, apply #175's updates except `mdast-util-to-markdown`, then run `pnpm dedupe`. Skip any package `main` has already moved to the target version or later; for example #195 already took `astro` to 7.4.7 in `/site`. Updates: lucide-react 1.52.0 → 1.70.0; mdast-util-definition-list 2.0.0 → 2.0.1; mdast-util-from-markdown 2.0.3 → 2.1.0; mermaid 12.0.0 → 12.3.0; micromark-extension-definition-list 2.0.1 → 2.0.2; zod 4.6.6 → 4.6.7; zustand 5.0.15 → 5.1.0; react, react-dom 19.3.0 → 19.3.1; /site: @astrojs/markdown-remark 7.3.1 → 7.3.6; @astrojs/react 7.0.0 → 7.1.4; @astrojs/starlight 0.42.5 → 0.42.10; astro 7.3.5 → 7.4.7.

Acceptance criteria: `tsc --noEmit`, `pnpm test`, `pnpm run build`, the examples build and the electron-shell e2e all pass in CI. The lockfile resolves exactly one copy of `micromark-util-types`. `mdast-util-to-markdown` stays at exactly `2.1.2`. No version of anything on `main` goes down.

Out of scope: Any code change in `src/`. If a type error survives the dedupe, stop and report it on this issue rather than patching code. vitest (tracked separately) and TypeScript 7 (#168, blocked upstream). Once this lands, close #175 if Dependabot hasn't already closed it as superseded."

## Background

Dependabot PR #175 (runtime-non-major group, 14 updates) cannot merge, for three independent reasons:

1. **Typecheck failure caused by a duplicated type package.** The lockfile on that branch holds two copies of `micromark-util-types` (2.0.2 and 2.0.3). `micromark-extension-gfm`'s `Extension` type resolves against one copy and `fromMarkdown`'s `Options` against the other, so `tsc --noEmit` reports TS2769 at `src/annotations/block-structure.ts(64,16)`. The editor code is correct and no single bump is to blame. Running `pnpm dedupe` on that branch collapses the copies, makes `tsc --noEmit` clean, and changes only `pnpm-lock.yaml`.
2. **Staleness.** The PR predates #174, so merging its `package.json` would downgrade eslint 10.13 → 10.11, typescript-eslint 8.72.1 → 8.71.2 and tsc-alias 1.9.9 → 1.9.7.
3. **An unwanted bump.** It moves `mdast-util-to-markdown` 2.1.2 → 2.2.3. That package is deliberately pinned at exactly 2.1.2 (see #157, the `//mdast-util-to-markdown` note in `package.json`, and its dedicated group in `.github/dependabot.yml`).

The goal is to land the wanted updates from #175 on top of current `main`, with a lockfile that resolves a single `micromark-util-types`, so the editor stays current without regressing anything or touching the pinned package.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Runtime dependencies are current and the build is green (Priority: P1)

A maintainer wants the runtime-non-major updates from #175 merged, in a form that passes CI, instead of a stale Dependabot PR that cannot.

**Why this priority**: It is the entire purpose of the issue; everything else constrains how it is done.

**Independent Test**: On the resulting branch, run `tsc --noEmit`, `pnpm test`, `pnpm run build`, the examples build and the electron-shell e2e; all pass.

**Acceptance Scenarios**:

1. **Given** current `main`, **When** the listed updates are applied (skipping any already at the target or later) and the lockfile is deduped, **Then** `tsc --noEmit` reports no errors, including none at `src/annotations/block-structure.ts`.
2. **Given** the updated branch, **When** CI runs, **Then** unit tests, the package build, the examples build and the electron-shell e2e all pass.
3. **Given** the updated `package.json` files (root and `/site`), **When** each listed package is inspected, **Then** it is at the target version or a later one already on `main`.

---

### User Story 2 - The lockfile resolves a single `micromark-util-types` (Priority: P1)

A maintainer wants the root cause of the typecheck failure removed, not merely masked, so the same split cannot recur silently with these versions.

**Why this priority**: The duplicate copy is the actual blocker for #175; without it the updates cannot pass `tsc`.

**Independent Test**: Inspect `pnpm-lock.yaml` (or `pnpm why micromark-util-types`) and confirm exactly one resolved version.

**Acceptance Scenarios**:

1. **Given** the updated lockfile, **When** `micromark-util-types` entries are listed, **Then** exactly one version is resolved.
2. **Given** the lockfile after dedupe, **When** the diff against `main` is reviewed, **Then** it reflects only the intended updates plus the dedupe, and nothing else is downgraded.

---

### User Story 3 - Pinned and already-newer packages are protected (Priority: P1)

A maintainer wants assurance that this change does not move the deliberately pinned `mdast-util-to-markdown`, and does not roll back any work already on `main`.

**Why this priority**: These are the two defects that make #175 unmergeable as-is; reintroducing either would defeat the issue.

**Independent Test**: Compare resolved versions on the branch against `main`, and check the `mdast-util-to-markdown` entry in both `package.json` and the lockfile.

**Acceptance Scenarios**:

1. **Given** the updated branch, **When** `mdast-util-to-markdown` is inspected in `package.json` and the lockfile, **Then** it is exactly `2.1.2`, and the pin note and dependabot group are unchanged.
2. **Given** the updated branch, **When** every resolved package version is compared with `main`, **Then** none is lower (in particular eslint, typescript-eslint, tsc-alias and astro).

---

### User Story 4 - Superseded PR #175 is closed (Priority: P2)

A maintainer wants no lingering, unmergeable PR once the equivalent change has landed.

**Why this priority**: Housekeeping; it follows once the main work merges.

**Independent Test**: After merge, #175 is in a closed state.

**Acceptance Scenarios**:

1. **Given** this change has merged, **When** Dependabot has not already closed #175 as superseded, **Then** #175 is closed manually.

---

### Edge Cases

- A package listed in the table is already at the target version or later on `main` (e.g. `astro` in `/site` via #195, or `react`/`react-dom` ranges already at `^19.3.1`): leave it as is; do not "update" it to the table's version.
- `pnpm dedupe` changes the resolution of packages beyond `micromark-util-types`: acceptable only if no resolved version drops below what `main` has, and `mdast-util-to-markdown` stays at 2.1.2.
- A type error survives the dedupe: stop and report it on this issue; do not patch `src/`.
- A newly updated package (e.g. `mdast-util-from-markdown` 2.1.0 or `mermaid` 12.3.0) causes a test, build, examples or e2e failure unrelated to typing: report it on this issue instead of working around it in code.
- The dedupe pulls `mdast-util-to-markdown` to a newer version transitively: this violates the pin and must be resolved before the change is acceptable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The root package updates in the table (lucide-react, mdast-util-definition-list, mdast-util-from-markdown, mermaid, micromark-extension-definition-list, zod, zustand, react, react-dom) are applied on top of current `main`, each to the stated target version or later.
- **FR-002**: The `/site` package updates in the table (@astrojs/markdown-remark, @astrojs/react, @astrojs/starlight, astro) are applied on top of current `main`, each to the stated target version or later.
- **FR-003**: Any package that `main` already has at the target version or later is left unchanged.
- **FR-004**: `mdast-util-to-markdown` remains pinned at exactly `2.1.2` in `package.json` and in the resolved lockfile; the pin note and its dependabot group are untouched.
- **FR-005**: `pnpm dedupe` is run after the updates, so that the lockfile resolves exactly one copy of `micromark-util-types`.
- **FR-006**: No package version resolved on `main` (including eslint, typescript-eslint, tsc-alias) is lower after this change.
- **FR-007**: No file under `src/` is modified.
- **FR-008**: `tsc --noEmit`, `pnpm test`, `pnpm run build`, the examples build and the electron-shell e2e all pass in CI.
- **FR-009**: If a type error persists after the dedupe, work stops and the error is reported on this issue rather than fixed in code.
- **FR-010**: After the change lands, #175 is closed if Dependabot has not already closed it as superseded.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: CI is fully green (typecheck, unit tests, package build, examples build, electron-shell e2e) on the change.
- **SC-002**: The lockfile contains exactly one resolved version of `micromark-util-types`.
- **SC-003**: `mdast-util-to-markdown` resolves to exactly 2.1.2 everywhere in the lockfile.
- **SC-004**: A version-by-version comparison of the lockfile against `main` shows zero downgrades.
- **SC-005**: The diff contains changes only to manifests (`package.json`, `site/package.json`) and lockfiles, with zero changes under `src/`.
- **SC-006**: #175 is closed after the change merges.

## Assumptions

- "Current `main`" is the base at implementation time; the table's "From" versions are indicative, and `main` may already be ahead for some packages (the manifests on `main` show, for example, `react`/`react-dom` dev ranges already at `^19.3.1`). The rule is "reach the target version or later; never go down".
- Updating a manifest range (e.g. bumping a `^` floor) is sufficient where the lockfile then resolves to at least the target; the dependency-range style already used in each manifest is kept.
- The `/site` lockfile or workspace is handled with the same dedupe discipline as the root, and the "one copy of `micromark-util-types`" requirement applies to the root package's lockfile, where the typecheck failure occurs.
- The dedupe is expected to change only `pnpm-lock.yaml`, as observed on the #175 branch.
- Dependabot may close #175 itself as superseded once the updates land on `main`.

## Out of Scope *(optional)*

- Any code change in `src/`; a surviving type error is reported, not patched.
- vitest updates (tracked separately).
- TypeScript 7 (#168, blocked upstream).
- Moving `mdast-util-to-markdown` beyond 2.1.2 or altering its pin, note or dependabot group (#157).
- Changing Dependabot configuration or grouping.

## Source References *(optional)*

- Dependabot PR #175 (runtime-non-major, 14 updates)
- #174 (eslint / typescript-eslint / tsc-alias bumps that #175 would regress)
- #157 (`mdast-util-to-markdown` pin)
- #195 (astro 7.4.7 in `/site`)
- #168 (TypeScript 7, blocked upstream)
