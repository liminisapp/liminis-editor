# Feature Specification: Point live references at liminisapp and docs.liminis.app after the org move

**Feature Branch**: `fabrik/issue-148`
**Created**: 2026-10-04
**Status**: Specified
**Input**: User description: "Point live references at liminisapp and docs.liminis.app after the org move"

## Background

This repository moved from `verveguy/liminis-editor` to **`liminisapp/liminis-editor`** on 2026-10-04. Its documentation site moved from `v3rv.com/liminis-editor/` to **`https://docs.liminis.app/liminis-editor/`**. The old URLs redirect, so nothing is broken for readers today, but live references should point at the new homes.

One reference is not cosmetic. `package.json`'s `repository` field names the old repository. `npm publish --provenance` checks that field against the repository the publish workflow ran in, so **the next release fails until `repository.url` is corrected**.

The change is a targeted sweep, not a blanket find-and-replace. Many files mention the old names for historical reasons (ADRs, release notes, specs, issue links). Those record where things were, and they still redirect, so they stay as written.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The next release publishes with provenance (Priority: P1)

A maintainer cuts the next release. The publish workflow runs in `liminisapp/liminis-editor` and `npm publish --provenance` accepts the package.

**Why this priority**: This is the only reference whose staleness blocks work. Everything else is correctness and tidiness.

**Independent Test**: Run `npm pack --dry-run` and inspect the manifest. `repository.url` is `git+https://github.com/liminisapp/liminis-editor.git`, and `bugs.url` and `homepage` point at `liminisapp`.

**Acceptance Scenarios**:

1. **Given** the updated `package.json`, **When** `npm pack --dry-run` runs, **Then** the reported `repository` is `liminisapp/liminis-editor`.
2. **Given** the updated `package.json`, **When** the package is built, **Then** the build succeeds unchanged.

---

### User Story 2 - The docs site is served from its new host (Priority: P1)

A reader opens the docs site. Canonical URLs, sitemap, "Edit this page" links and the GitHub social link all use the new host and organization.

**Why this priority**: The site build is the generator for most user-facing URLs. If its config is wrong, every built page is wrong.

**Independent Test**: Build the docs site and search the built HTML for old references.

**Acceptance Scenarios**:

1. **Given** the updated site config, **When** the docs site is built, **Then** no built HTML contains `v3rv.com/liminis-editor`.
2. **Given** the same build, **Then** no built HTML contains `github.com/verveguy/liminis-editor` except issue, PR or discussion links.
3. **Given** the updated config, **Then** the site `base` is still `/liminis-editor`, so the site is served at `https://docs.liminis.app/liminis-editor/`.
4. **Given** a built docs page, **When** the reader follows "Edit this page", **Then** the link targets `https://github.com/liminisapp/liminis-editor/edit/main/docs/...`.

---

### User Story 3 - README and tooling defaults point at the new homes (Priority: P2)

A newcomer follows README links, and a developer runs the Electron demo check with no arguments. Both reach the new locations.

**Why this priority**: These are user-facing, but the old URLs redirect, so impact is low.

**Independent Test**: Read the README links. Run `git grep` over the tree and confirm only historical references remain.

**Acceptance Scenarios**:

1. **Given** the updated README, **Then** its docs-site links use `docs.liminis.app/liminis-editor/…`.
2. **Given** no URL argument, **When** `examples/electron/check-demo.mjs` runs, **Then** it targets `https://docs.liminis.app/liminis-editor/`.

---

### Edge Cases

- **Historical references that look live.** Issue, PR and discussion links such as `verveguy/liminis-editor/issues/NNN`, and shorthand such as `verveguy/liminis-editor#NN` in code comments, specs, ADRs and fixture READMEs, must not be changed.
- **The private app repo.** `verveguy/liminis` is a different repository and is not affected. Its references must not be changed.
- **Workflows.** Files under `.github/workflows/` must not be touched, even where they contain `verveguy`. Those references are historical comments or name a user (e.g. `--assignee verveguy`).
- **Base path versus host.** Only the host changes. Changing `base` would break every in-site link.
- **Sibling project links.** `site/src/content/docs/index.mdx` links `https://v3rv.com/liminis-diagrams/`. That is another project's site, not this one's.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `package.json` MUST set `repository.url` to `git+https://github.com/liminisapp/liminis-editor.git`, and `bugs.url` and `homepage` to the `liminisapp` equivalents.
- **FR-002**: `site/astro.config.mjs` MUST set `site` to `https://docs.liminis.app`, set `social.github` to the `liminisapp` repository, and update the nearby comment about the user site so it no longer describes `v3rv.com`.
- **FR-003**: `site/scripts/sync-docs.mjs` MUST set `EDIT_BASE` to `https://github.com/liminisapp/liminis-editor/edit/main/docs`.
- **FR-004**: `examples/electron/check-demo.mjs` MUST default its URL to `https://docs.liminis.app/liminis-editor/`.
- **FR-005**: `README.md` and `docs/**` MUST replace `v3rv.com/liminis-editor/…` with `docs.liminis.app/liminis-editor/…`, and non-issue `github.com/verveguy/liminis-editor/…` links with `liminisapp`.
- **FR-006**: Any other live reference found by the sweep MUST be updated. Live means package and crate metadata, docs-site config, README and user-facing docs links, install commands, CLI help text and generator scripts.
- **FR-007**: Historical references MUST remain unchanged: ADRs, `docs/releases/**`, `CHANGELOG*`, history and spike docs, specs, test-fixture READMEs, and issue/PR/discussion links.
- **FR-008**: Nothing under `.github/workflows/` MAY be edited.
- **FR-009**: References to `verveguy/liminis` MUST be left alone.
- **FR-010**: The docs-site `base` path MUST remain `/liminis-editor`.

### Key Entities

- **Live reference**: A URL or repository slug that users, tooling or npm act on today.
- **Historical reference**: A mention that records where something was at the time it was written. It is kept as written and relies on the redirect.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The package builds, and `npm pack --dry-run` shows `repository` as `liminisapp/liminis-editor`.
- **SC-002**: The docs site builds, and its built HTML contains zero occurrences of `v3rv.com/liminis-editor` and zero non-issue/PR/discussion occurrences of `github.com/verveguy/liminis-editor`.
- **SC-003**: `git grep -nE 'v3rv\.com/liminis-editor|github\.com/verveguy/liminis-editor'` lists only historical references (for example the round-trip fixture README's issue links).
- **SC-004**: `git diff` shows no changes under `.github/workflows/`, `docs/decisions/`, `docs/releases/`, `specs/` (other than this spec) or `CHANGELOG*`.

## Assumptions

- Docs-site hosting, DNS and deployment for `docs.liminis.app` are already in place. This issue changes configuration only.
- A user-site base of `/liminis-editor` is still correct on the new host, as the issue states.
- Short-form issue references in comments (`verveguy/liminis-editor#NN`) are historical and stay.
- `CLAUDE.md`'s ADR header template (`**Issue:** #<n> (verveguy/liminis-editor)`) is not in the issue's list of files to change and matches existing ADRs, so it stays as is. Revisiting it is a follow-up.
- The `https://v3rv.com/liminis-diagrams/` link in `site/src/content/docs/index.mdx` points at a different project and is out of scope here. It is a candidate for a follow-up if that site has also moved.
- The `CHANGELOG` gets no entry. The change is metadata and links with no consumer-visible package behaviour, and the `Unreleased` rule in `CLAUDE.md` applies only if an entry is written.
- No version bump is made.

## Out of Scope

- Editing ADRs, release notes, `CHANGELOG*`, history/spike docs, specs, fixture READMEs, or issue/PR/discussion links.
- Editing anything under `.github/workflows/`.
- References to the private `verveguy/liminis` repository.
- Changing the docs-site `base` path.
- Cutting a release or publishing.
- Links to sibling projects' sites (e.g. `liminis-diagrams`).

## Source References

- `package.json` (`repository`, `bugs`, `homepage`)
- `site/astro.config.mjs`
- `site/scripts/sync-docs.mjs`
- `examples/electron/check-demo.mjs`
- `README.md`
- `CLAUDE.md` (History and Releases sections)
