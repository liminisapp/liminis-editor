# Feature Specification: Upgrade vitest and @vitest/coverage-v8 to 5.1 together

**Feature Branch**: `fabrik/issue-198`
**Created**: 2026-11-14
**Status**: Specified
**Input**: User description: "## Problem

The editor is on `vitest` and `@vitest/coverage-v8` `^4.1.5`. `@vitest/coverage-v8` peers its vitest version **exactly**, so the two packages can only move together.

Dependabot can't do that. Even with both in the `vitest` group (added in #184), it computes each package's update on its own against the current lockfile. coverage-v8 5 can't install next to vitest 4, so it drops out, and #186 arrives carrying `vitest` 5.1.0 alone. Its `checks` job then fails at `pnpm test:coverage`:

```
Loaded vitest@5.1.0 and @vitest/coverage-v8@4.1.10.
TypeError: Expected string coverage payload, received object
```

## Change

- In `package.json`, raise `vitest` and `@vitest/coverage-v8` to `^5.1.0` in the same commit, and regenerate `pnpm-lock.yaml`.
- Adapt to any vitest 5 breaking changes in config or test setup (`vitest.config.*`, `tests/setup.ts`). Use the vitest 5 migration notes. liminis-diagrams is already on vitest 5.1 (diagrams#87) and can serve as a reference config.
- Keep the existing coverage settings and thresholds as they are.

## Acceptance criteria

- `pnpm test`, `pnpm test:coverage`, the typecheck and `pnpm run build` all pass locally and in CI.
- `pnpm-lock.yaml` resolves exactly one `vitest` 5.1.x and one `@vitest/coverage-v8` 5.1.x.
- No other dependency changes. Diff limited to `package.json`, `pnpm-lock.yaml` and any test/config files vitest 5 requires.

## Out of scope

- Other dependency updates, including the open runtime group (#175).
- `.github/dependabot.yml`. The `vitest` group stays; it still handles vitest minors and patches.

Once this lands, Dependabot should close #186 as superseded."

## Background

The editor currently depends on `vitest` and `@vitest/coverage-v8` at `^4.1.5`. `@vitest/coverage-v8` pins its vitest peer to an exact version, so the two packages must be upgraded in lockstep.

Dependabot cannot perform that joint upgrade. Even with both packages in the `vitest` group (added in #184), it resolves each package's update independently against the current lockfile. `@vitest/coverage-v8` 5 cannot be installed alongside vitest 4, so it drops out of the group update, and Dependabot PR #186 arrives carrying only `vitest` 5.1.0. Its `checks` job then fails in `pnpm test:coverage` with a version-mismatch symptom:

```
Loaded vitest@5.1.0 and @vitest/coverage-v8@4.1.10.
TypeError: Expected string coverage payload, received object
```

The upgrade therefore has to be made by hand, in a single commit. The sibling repository liminis-diagrams already runs vitest 5.1 (diagrams#87), so its configuration is a usable reference for any vitest 5 migration changes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Move the test toolchain to vitest 5.1 as one consistent pair (Priority: P1)

A maintainer lands a single change that raises `vitest` and `@vitest/coverage-v8` to `^5.1.0` together, with a regenerated lockfile, so the repository's tests and coverage run on a matched vitest 5.1 pair.

**Why this priority**: This is the whole purpose of the issue. Until the pair moves together, the repository is stuck on vitest 4 and every Dependabot vitest PR fails CI.

**Independent Test**: On the branch, install from the lockfile and run the test, coverage, typecheck and build commands; inspect the lockfile for the resolved vitest versions.

**Acceptance Scenarios**:

1. **Given** the branch with the upgrade applied, **When** `pnpm test` is run, **Then** it passes.
2. **Given** the same branch, **When** `pnpm test:coverage` is run, **Then** it passes with the existing coverage settings and thresholds unchanged.
3. **Given** the same branch, **When** the typecheck and `pnpm run build` are run, **Then** both pass.
4. **Given** the regenerated `pnpm-lock.yaml`, **When** it is inspected, **Then** it resolves exactly one `vitest` version (5.1.x) and exactly one `@vitest/coverage-v8` version (5.1.x).
5. **Given** the pull request, **When** CI runs, **Then** all checks, including the `checks` job, are green.

---

### User Story 2 - Existing configuration and setup keep working under vitest 5 (Priority: P2)

Where vitest 5 introduces breaking changes affecting the repository's vitest configuration or test setup file, the maintainer adapts them with the smallest change that restores previous behaviour.

**Why this priority**: Needed only if the version bump alone does not leave the suite green. It is a consequence of Story 1, not an independent deliverable.

**Independent Test**: Compare test results and coverage output before and after the upgrade; confirm the same tests run and the coverage settings and thresholds are the ones that were in effect before.

**Acceptance Scenarios**:

1. **Given** a vitest 5 breaking change that affects the vitest config or test setup, **When** it is adapted, **Then** the change is confined to those files and the previous coverage settings and thresholds remain in force.
2. **Given** no vitest 5 breaking change affects the config or setup, **When** the upgrade is made, **Then** no config or setup files are modified.

---

### User Story 3 - Dependabot's stale vitest PR is superseded (Priority: P3)

After the upgrade merges, Dependabot recognises PR #186 as superseded and closes it, and its `vitest` group keeps handling later vitest minors and patches.

**Why this priority**: A follow-on effect of merging, not something this change implements. It is listed so that the expected outcome is explicit.

**Independent Test**: After merge, confirm #186 is closed by Dependabot and that `.github/dependabot.yml` is unchanged.

**Acceptance Scenarios**:

1. **Given** the upgrade has merged, **When** Dependabot next evaluates its open PRs, **Then** #186 is closed as superseded.

---

### Edge Cases

- `^5.1.0` could resolve to a different 5.x minor or patch than the one the lockfile pins; the lockfile must still contain exactly one version of each package, and the two must be mutually compatible.
- Regenerating the lockfile could incidentally bump unrelated dependencies; any such drift must be reverted so the lockfile diff reflects only the vitest pair and their own transitive dependencies.
- A vitest 5 change might alter the coverage payload or reporting behaviour; coverage thresholds must still be evaluated against the same settings as before, not loosened to make the run pass.
- Local and CI results could differ if the lockfile is not committed with the manifest; both must land in the same commit.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `package.json` declares both `vitest` and `@vitest/coverage-v8` at `^5.1.0`, changed in the same commit.
- **FR-002**: `pnpm-lock.yaml` is regenerated so that it resolves exactly one `vitest` 5.1.x and exactly one `@vitest/coverage-v8` 5.1.x, with no 4.x versions of either remaining.
- **FR-003**: Any vitest 5 breaking change affecting the vitest configuration or the test setup file is adapted so that test behaviour is equivalent to before the upgrade.
- **FR-004**: Existing coverage settings and thresholds are unchanged.
- **FR-005**: `pnpm test`, `pnpm test:coverage`, the typecheck and `pnpm run build` all pass locally and in CI.
- **FR-006**: No dependency other than `vitest`, `@vitest/coverage-v8` and their own transitive dependencies changes.
- **FR-007**: The diff is limited to `package.json`, `pnpm-lock.yaml` and any test or config files that vitest 5 requires to change.
- **FR-008**: `.github/dependabot.yml` is not modified; the `vitest` group remains.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Test, coverage, typecheck and build commands all exit successfully locally on the branch.
- **SC-002**: The CI `checks` job is green on the pull request, including the coverage step that failed on #186.
- **SC-003**: The lockfile contains exactly one resolved `vitest` entry and one `@vitest/coverage-v8` entry, both 5.1.x.
- **SC-004**: The set of changed files is limited to `package.json`, `pnpm-lock.yaml` and config or test files demonstrably required by vitest 5.
- **SC-005**: Coverage thresholds are numerically identical to those before the change, and the coverage run meets them.
- **SC-006**: After merge, Dependabot closes #186 as superseded.

## Assumptions

- Only dev dependencies change, so no consumer-facing release, version bump or CHANGELOG entry is needed. If a maintainer decides one is warranted, it would go under `## Unreleased` per the repository's release conventions.
- The vitest 5 migration notes and the liminis-diagrams configuration from diagrams#87 are sufficient guidance for any required config adaptation.
- Existing tests are expected to pass unmodified; test-file changes are made only if vitest 5 strictly requires them, not to work around genuine regressions.
- The `^5.1.0` range is acceptable (matching the range style already used) rather than an exact pin.

## Out of Scope *(optional)*

- Other dependency updates, including the open runtime group (#175).
- Any change to `.github/dependabot.yml`; the `vitest` group stays and continues to handle vitest minors and patches.
- Loosening, restructuring or otherwise changing coverage settings or thresholds.
- Fixing the underlying Dependabot limitation with lockstep exact-peer upgrades beyond this one-off manual upgrade.

## Source References *(optional)*

- Issue #198 (this issue)
- PR #186: Dependabot PR carrying `vitest` 5.1.0 alone, failing at `pnpm test:coverage`
- PR #184: added `vitest` and `@vitest/coverage-v8` to the Dependabot `vitest` group
- Issue #175: open runtime dependency group (out of scope)
- liminis-diagrams#87: vitest 5.1 upgrade in the sibling repository, usable as reference config
- vitest 5 migration notes
