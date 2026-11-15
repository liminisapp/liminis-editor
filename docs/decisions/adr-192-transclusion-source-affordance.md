# ADR-192: Transclusions Navigate to Their Source Through a Trailing Badge

**Date:** 2026-11-13
**Status:** Accepted
**Supersedes:** none
**Amends:** ADR-119 (§8, nested link navigation)
**Issue:** #192 (verveguy/liminis-editor)

## Context

`![[file#^id]]` transclusion (ADR-119, #119) renders the referenced block
inline, but the rendered output was a dead end: only `<span>`s, no `<a>`, so
`LinkClickPlugin` — which reacts to `a[data-href]` — never saw anything to
follow. A `[[file#^id]]` link was navigable; the same block embedded was not.

The block-scoped `OPEN_LINK { url, blockId }` path already exists (ADR-119 §9),
so the only missing piece was a link-shaped element on the transclusion.

## Decision

### 1. A trailing "↗" badge, not a whole-container link

Every transclusion renders `<a class="editor-link editor-transclusion-source"
data-href data-block-id>↗</a>` after its state span, in all four states
(resolved, unresolved, circular, depth-exceeded). It is a *sibling* of the
content, never an ancestor of it, so:

- `target.closest('a')` in `LinkClickPlugin` always finds the innermost anchor:
  a wiki link inside the transcluded content wins over the badge, with no
  `stopPropagation` ordering to maintain;
- no `<a>`-in-`<a>`;
- caret placement and selection inside the transcluded text are untouched.

`LinkClickPlugin`, `TransclusionNode`, `exportDOM` and the mdast round-trip are
unchanged. The badge is presentation only.

### 2. The badge carries `editor-link` but not `data-wiki-link`

`editor-link` makes the existing `modifier-held` / `links-clickable` cursor
rules apply with no new cursor CSS. `data-wiki-link` is deliberately absent:
`WikiLinkExistencePlugin` queries `a[data-wiki-link="true"]` and would resolve
the badge and could style it as a broken link.

### 3. `data-href` is normalised exactly as a wiki link is

`wikiTargetToUrl(target)` (in `src/utils/file-types.ts`) appends `.md` to a
target without a recognised extension. The mapper's duplicated expressions now
call it too. A host that handles block-scoped links therefore receives the same
`url` shape from `![[x#^id]]` as from `[[x#^id]]`.

### 4. Nested wiki links in transcluded content are now live

ADR-119 §8 left `wikiLink` inside transcluded content as inert text. That had to
change: with a badge present but nested links inert, the requirement that a
nested link navigate to *its own* target would pass vacuously. They render as
`<a class="editor-link" data-href data-block-id?>`, again without
`data-wiki-link` (the existence plugin only walks the editor's own DOM, and
resolver calls per nested link are not wanted).

### 5. The badge renders from props, not from resolved state

`TransclusionComponent` passes `{ file, blockId }` from its props, so the badge
is present and stable across debounced re-resolves. It is absent only in the
loading state, which is not one of the four states in scope. A nested
`wikiEmbed` passes its own `{ file, blockId }`, so each level navigates to its
own source.

### 6. `contenteditable="false"` and accessible name

The badge is `contenteditable="false"` so the caret does not land inside it. It
has `title` and `aria-label` "Open source block". It has no `href` or
`tabindex`, matching every other editor link, so keyboard activation is
whatever existing links support (nothing new).

## Consequences — what this costs

- **An always-present "↗" glyph** in transclusions, including editable mode.
  Existing transclusions grow by one small element; a host that screenshots or
  styles transclusions will see it. It can be restyled or hidden via
  `.editor-transclusion-source` without changing the emitted event.
- **A larger click target in read-only mode.** A plain click on the badge
  navigates there, where previously nothing did. Nested wiki links in
  transcluded content also now navigate on click, which they never did.
- **A small `contenteditable="false"` island** inside editable content, next to
  an inline decorator. It was verified in jsdom (a plain click is not
  default-prevented and does not navigate) but not in a real browser, where
  caret behaviour around inline decorators is Lexical's and the browser's call.
- **Not keyboard-focusable.** Consistent with existing links, but it means the
  affordance is pointer-only until links gain `tabindex`/`href` generally.
- **The whole transclusion is not a link target.** Clicking the transcluded text
  still does nothing; only the badge navigates. That was a design choice, and a
  whole-container target can be added later without changing the event.
- **Unresolved/circular/depth-exceeded states pass the block id along.** The
  host may ignore it if the block no longer exists; the file still opens, which
  is what a user repairing a broken reference needs.
- **Not done: making the transcluded checkbox writable** (#181) and host-side
  scroll-to-block (shadoworg/liminis-notes#1318).

## References

- ADR-119 — transclusion node and renderer (§8 amended, §9 reused)
- ADR-122 — block-anchor badge (visual vocabulary)
- Issue #192 (this ADR), #119 (transclusion), #181 (one logical item)
