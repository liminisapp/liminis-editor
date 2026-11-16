# ADR-203: The C4 Node Cancels the Release Shift by Measuring It, Not from `onFrameChange`

**Date:** 2026-11-15
**Status:** Accepted
**Supersedes:** none
**Amends:** none
**Issue:** #203 (verveguy/liminis-editor)

## Context

`@liminis/diagrams` 0.2.0 (its ADR-100) grows the C4 diagram's SVG frame live while
a node is dragged past an edge. During the drag the renderer holds the diagram's
origin steady with an imperative `svg.style.transform`; on release it clears that
transform and the origin jumps to the natural origin of the larger frame. The
library leaves cancelling that jump to the host.

The editor's C4 node wraps the renderer in a flex-centred, `overflow-x: auto`
container. So on release the diagram jumps by the full growth for top/left growth,
and by half the growth for growth on any horizontal side (centring). The user sees
the node they just dropped move away from the pointer.

## Decision

`C4DiagramDisplay` (`src/app/editor/nodes/C4Component.tsx`) measures the jump and
cancels it with a host-owned offset on the diagram's `<svg>`:

1. `onPositionChange` is called by the renderer synchronously at release, before the
   transform is cleared, and not at all for a cancelled drag. The handler records the
   svg's `getBoundingClientRect()` and bumps a render tick, so the component
   re-renders in the same batch as the renderer's release render.
2. A no-dependency `useLayoutEffect` runs after the renderer's own (child) layout
   effect. Once `style.transform` is empty it measures the svg again and adds
   `before − after` to a per-instance offset.
3. The offset is written as the CSS `translate` property (`svg.style.translate`),
   which composes with the renderer's `transform` and which the renderer never
   writes. The write happens in the layout phase, so no frame is painted with the
   jump in it.
4. The offset resets when layout mode exits. The container also gets
   `overflow-anchor: none` so scroll anchoring cannot add a second adjustment.

Because the shift is measured rather than computed from the growth, one mechanism
covers left, top, right (the centring half-growth), corners, several sides in one
drag, net growth smaller than the peak, a container that was already scrolled, and
growth deferred to release by the renderer's 48px cap. A drag that does not grow
the frame measures zero and writes nothing.

### Why `onFrameChange` is not used (the FR-005 reason)

`onFrameChange` reports `{ width, height }` in unscaled diagram units. It carries no
origin and no per-side growth, so it cannot tell a left-edge growth (which moves the
origin) from a right-edge one; it carries no drag or release signal; and it is silent
while the growth cap holds the frame, which is exactly when growth is deferred to
release. It could at most say that the width changed. The quantity that moves the
dropped node on screen is the origin's screen position, so that is what is measured.

### The 48px growth cap

The cap applies only when the rendered scale differs from the drag-start scale
(zoom-to-fit) and the pointer is within 48px of the scroll container's edge. This
editor never passes `zoom`, so the cap cannot engage here today. If it ever does,
the deferred growth lands at release and goes through the same measure-and-cancel
path, which a unit test simulates. A test also asserts that `zoom` is not passed, so a
later zoom-to-fit change fails it and sends the next person back here.

## Alternatives rejected

- **Adjust `scrollLeft`.** It only has range when the content overflows. A diagram
  narrower than its container (the common case) cannot be corrected by scrolling, and
  `scrollTop` cannot go negative for top growth.
- **A wrapper `<div>` with `transform`.** It would become the flex item, so
  `.c4-renderer svg { max-width: 100% }` would resolve against an auto-width wrapper
  and change diagram sizing on entering layout mode.
- **Drop the centring.** Users rely on it, and it would not cancel the top/left shift.
- **Use `getScreenCTM()` for the measurement.** The renderer's own code notes that
  engines have been inconsistent about whether it includes CSS transforms. The bounding
  rect always does.

## Cost

- After a frame-growing drag the diagram stays off-centre by the cancelled shift until
  layout mode is exited. That is deliberate: where the user dropped the node is what counts.
- Nothing is un-clipped. The offset reproduces the pre-release visual state, so
  content pushed outside the container's scrollable area during the drag stays
  clipped, as it was during the drag.
- The fix depends on library internals: the transform being cleared in a child layout
  effect, `onPositionChange` firing synchronously at release and not on cancel, and
  the renderer not writing `style.translate`. The unit tests lock the ordering with a
  fake renderer that mirrors it. The Electron e2e (`examples/electron/e2e/c4-release-shift.spec.ts`)
  measures real Chromium geometry to 1px and fails when the compensation is removed.
- `onFrameChange` stays unused.

> **Amended 2026-11-16 — the translate-only approach no longer holds for vertical
> growth (issue #206).** A translate is visual only, so the container's layout box
> does not grow with it. For top growth the cancelling translate moved the grown
> strip above the container's top edge, and the container clips there
> (`overflow-x: auto` makes its computed `overflow-y` clip too, and it has only `1rem`
> of padding). A node dropped partly above the top ended up mostly hidden, which is
> worse than the jump this ADR removed. What changed:
>
> - **Measurement is unchanged** (the svg's bounding rect before and after release).
>   Only how the measured shift is applied changes.
> - **Vertical: no translate at all.** The container grows with the frame, and the
>   shift is cancelled by scrolling the nearest vertically scrolling ancestor
>   (`scrollContainerFor`, ADR-088, else the document) by the measured amount, with
>   `behavior: 'instant'`. The browser clamps to the scroll range, so with no range (a
>   short, non-scrolling document) or only a partial range the remainder is accepted as
>   a visible shift. A visible jump is better than clipped content.
> - **Horizontal: scroll first, then a guarded translate.** If the container's content
>   overflows, its `scrollLeft` absorbs the shift. Whatever remains (all of it when
>   nothing overflows, the centred common case) is a translate, clamped so the svg
>   stays inside the container's padding box. If the svg is wider than the box, or the
>   translate would otherwise clip, the shift is accepted instead. The host offset is
>   now x-only.
> - **`justify-content: safe center`** replaces `center` on the container. With plain
>   centring an overflowing svg overflows equally both ways and the left half cannot be
>   scrolled to, so left growth could not be recovered with `scrollLeft`.
> - `overflow-anchor: none` stays, so scroll anchoring adds no second adjustment.
>
> **The "Alternatives rejected" scroll option is revisited.** It was rejected because a
> narrow, centred diagram has no horizontal range and `scrollTop` cannot go negative.
> Neither holds for vertical growth once the container grows: the content is pushed
> down, so the *ancestor* has range to scroll down into. Horizontal scrolling is still
> only possible when the content overflows, which is why the translate remains there.
>
> **The "Cost" clause "Nothing is un-clipped" no longer holds.** The cost now is a
> visible shift wherever compensation cannot be done without clipping: a non-scrolling
> (or exhausted) vertical scroller, or a horizontal drop so close to the container edge
> that the grown frame cannot be translated back inside it. The e2e measured the
> latter: the svg frame carries about 40px of empty margin around the nodes, so a drop
> within that margin of the container's edge shifts a few pixels even though the node
> itself would still fit. The guard cannot tell frame from content, so it errs towards
> not clipping.
> The e2e now also asserts the dropped node's whole box lies inside the visible area
> (viewport and every clipping ancestor), and fails if the container clips it.
