/**
 * C4 node: the dropped node must not jump when a frame-growing drag is released, and
 * must never be clipped by the compensation (ADR-203, issues #203 and #206).
 *
 * `@liminis/diagrams` 0.2.x holds the diagram's origin steady during a drag with
 * an imperative `style.transform`, and clears it on release; the origin then jumps
 * by however much the frame grew (and, in this centring container, by half the
 * growth on the right). The host cancels that jump:
 *   - vertically by scrolling the nearest vertical scroller (or the document), never
 *     with a translate, which would push the grown strip above the container's
 *     clipping edge (#206);
 *   - horizontally by the container's own scroll position when its content
 *     overflows, otherwise by a translate that is clamped so it never clips.
 *
 * happy-dom has no layout, so the renderer, the geometry and the scrollers are
 * faked — but the fake is built to be able to fail the way the real thing does:
 *   - the geometry is non-identity (a base offset, pre-scrolled scrollers), since
 *     identity stubs cannot fail on this bug;
 *   - the fake renderer clears `style.transform` in a CHILD layout effect, so the
 *     child-before-parent effect ordering the fix relies on is locked in;
 *   - `onPositionChange` fires at release, before the transform is cleared, and
 *     never for a cancelled drag, as in the 0.2.x renderer;
 *   - scrollers clamp to their range, and the svg's rect subtracts every scroll offset.
 * Real pixel accuracy, and the clipping itself, are the e2e's job; see ADR-203.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { createEditor, $getRoot } from 'lexical';
import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import C4Component from '../nodes/C4Component';
import { C4Node, $createC4Node } from '../nodes/C4Node';

interface Shift {
  /**
   * How far the diagram moves on screen when the renderer adopts the grown frame:
   * positive when the frame grew left or up (the content is pushed right or down).
   */
  x: number;
  y: number;
}

/** A scroller with a clamped range; the svg's on-screen rect subtracts its offset. */
interface ScrollerModel {
  top: number;
  left: number;
  maxTop: number;
  maxLeft: number;
  scrollTo: ReturnType<typeof vi.fn>;
}

interface FakeControls {
  /** Natural (un-translated) origin of the diagram's svg on screen. */
  origin: { x: number; y: number };
  zoomProp: unknown;
  onFrameChangeProp: unknown;
  start(): void;
  /** The frame grows by `shift` live; the renderer re-holds the origin. */
  grow(shift: Shift): void;
  /** Complete the drag. `deferred` lands the growth only after `onPositionChange`. */
  release(deferred?: Shift): void;
  cancel(): void;
  svg(): SVGSVGElement;
}

const registry = vi.hoisted(() => ({
  controls: [] as FakeControls[],
  bySvg: new WeakMap<Element, FakeControls>(),
  baseOrigin: { x: 100, y: 60 },
  svgWidth: 10,
  scrollers: [] as ScrollerModel[],
}));

vi.mock('@liminis/diagrams/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@liminis/diagrams/react')>();
  const React = await import('react');

  function FakeInteractiveRenderer(props: {
    onPositionChange: (p: Record<string, { x: number; y: number }>) => void;
    zoom?: unknown;
    onFrameChange?: unknown;
  }) {
    const { useState, useRef, useLayoutEffect } = React;
    const [dragging, setDragging] = useState(false);
    const [, force] = useState(0);
    const svgRef = useRef<SVGSVGElement>(null);
    const start = useRef<{ x: number; y: number } | null>(null);
    const propsRef = useRef(props);
    propsRef.current = props;
    const self = useRef<FakeControls | null>(null);

    if (!self.current) {
      self.current = {
        origin: { ...registry.baseOrigin },
        zoomProp: undefined,
        onFrameChangeProp: undefined,
        start: () => setDragging(true),
        grow: (s) => {
          self.current!.origin = {
            x: registry.baseOrigin.x + s.x,
            y: registry.baseOrigin.y + s.y,
          };
          force((n) => n + 1);
        },
        release: (deferred) => {
          propsRef.current.onPositionChange({ a: { x: 1, y: 1 } });
          if (deferred) {
            self.current!.origin = {
              x: registry.baseOrigin.x + deferred.x,
              y: registry.baseOrigin.y + deferred.y,
            };
          }
          setDragging(false);
        },
        cancel: () => {
          self.current!.origin = { ...registry.baseOrigin };
          setDragging(false);
        },
        svg: () => svgRef.current!,
      };
      registry.controls.push(self.current);
    }
    self.current.zoomProp = props.zoom;
    self.current.onFrameChangeProp = props.onFrameChange;

    // Mirrors the renderer's origin hold: a layout effect with no dependency array
    // that clears `transform` on release and otherwise re-holds the drag-start origin.
    useLayoutEffect(() => {
      const svg = svgRef.current;
      if (!svg) return;
      registry.bySvg.set(svg, self.current!);
      if (!dragging) {
        if (svg.style.transform) svg.style.transform = '';
        start.current = null;
        return;
      }
      svg.style.transform = '';
      const ctm = self.current!.origin;
      if (start.current === null) start.current = { ...ctm };
      const dx = start.current.x - ctm.x;
      const dy = start.current.y - ctm.y;
      if (dx !== 0 || dy !== 0) svg.style.transform = `translate(${dx}px, ${dy}px)`;
    });

    return React.createElement(
      'div',
      null,
      React.createElement(
        'div',
        null,
        React.createElement('svg', { ref: svgRef, 'data-diagram': 'c4', width: 10, height: 10 }),
      ),
    );
  }

  return { ...actual, C4InteractiveRenderer: FakeInteractiveRenderer };
});

/** Parses `Npx` / `translate(Npx, Mpx)` / `Npx Mpx` as written by the code under test. */
function parsePx(value: string): { x: number; y: number } {
  const nums = [...value.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  return { x: nums[0] ?? 0, y: nums[1] ?? 0 };
}

// Saved so it can be restored, and called with an explicit `this`.
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
const callOriginalRect = (el: Element) => originalGetBoundingClientRect.call(el);

const scrolled = () => ({
  x: registry.scrollers.reduce((n, m) => n + m.left, 0),
  y: registry.scrollers.reduce((n, m) => n + m.top, 0),
});

const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));

/** Makes `el` a scroller with a clamped range, and registers it in the rect model. */
function installScroller(
  el: Element,
  opts: { maxTop?: number; maxLeft?: number; top?: number; left?: number } = {},
): ScrollerModel {
  const m: ScrollerModel = {
    top: 0,
    left: 0,
    maxTop: opts.maxTop ?? 0,
    maxLeft: opts.maxLeft ?? 0,
    scrollTo: vi.fn(),
  };
  m.top = clamp(opts.top ?? 0, m.maxTop);
  m.left = clamp(opts.left ?? 0, m.maxLeft);
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => m.top,
    set: (v: number) => {
      m.top = clamp(v, m.maxTop);
    },
  });
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    get: () => m.left,
    set: (v: number) => {
      m.left = clamp(v, m.maxLeft);
    },
  });
  m.scrollTo.mockImplementation((o: { top?: number; left?: number }) => {
    if (o.top !== undefined) m.top = clamp(o.top, m.maxTop);
    if (o.left !== undefined) m.left = clamp(o.left, m.maxLeft);
  });
  Object.defineProperty(el, 'scrollTo', { configurable: true, value: m.scrollTo });
  registry.scrollers.push(m);
  return m;
}

beforeEach(() => {
  registry.controls.length = 0;
  registry.scrollers.length = 0;
  registry.baseOrigin = { x: 100, y: 60 };
  registry.svgWidth = 10;
  // Real engines include CSS transform and translate in the bounding box, and the
  // box moves with every scroller above the element.
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const ctl = registry.bySvg.get(this);
    if (!ctl) return callOriginalRect(this);
    const el = this as SVGSVGElement;
    const t = parsePx(el.style.transform);
    const tr = parsePx(el.style.translate);
    const sc = scrolled();
    const left = ctl.origin.x + t.x + tr.x - sc.x;
    const top = ctl.origin.y + t.y + tr.y - sc.y;
    const w = registry.svgWidth;
    return { left, top, right: left + w, bottom: top + 10, width: w, height: 10, x: left, y: top, toJSON() {} };
  };
});

afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
   
  const docEl = document.documentElement as any;
  delete docEl.scrollTop;
  delete docEl.scrollLeft;
  delete docEl.scrollTo;
   
  delete (document as any).scrollingElement;
});

const CODE = `Person(user, "User", "A user")\nSystem(app, "App", "Main app")`;

function makeEditor() {
  const editor = createEditor({
    namespace: 'c4-release-shift',
    nodes: [C4Node],
    onError: (e) => {
      throw e;
    },
  });
  let key = '';
  editor.update(
    () => {
      const node = $createC4Node(CODE);
      $getRoot().append(node);
      key = node.getKey();
    },
    { discrete: true },
  );
  return { editor, key };
}

interface RenderOpts {
  count?: number;
  /** The document scroller (default: lots of range, already scrolled a little). */
  doc?: { maxTop: number; top?: number };
  /** Put the nodes inside the editor's own scroller (`#editor-scroll-container`). */
  pane?: { maxTop: number; top?: number };
  /** The diagram container's horizontal geometry. */
  container?: { left?: number; width?: number; scrollWidth?: number; maxLeft?: number; scrollLeft?: number };
}

function renderNodes(opts: RenderOpts = {}) {
  const { count = 1, doc = { maxTop: 5000, top: 200 }, pane, container: cfg = {} } = opts;
  const docScroller = installScroller(document.documentElement, doc);
  Object.defineProperty(document, 'scrollingElement', {
    configurable: true,
    get: () => document.documentElement,
  });
  const { editor, key } = makeEditor();
  const nodes = Array.from({ length: count }, (_, i) => (
    <div key={i} data-testid={`node-${i}`}>
      <C4Component code={CODE} nodeKey={key} />
    </div>
  ));
  const ui = render(
    <LexicalComposerContext.Provider value={[editor, { getTheme: () => null }]}>
      {pane ? <div id="editor-scroll-container" data-testid="pane">{nodes}</div> : nodes}
    </LexicalComposerContext.Provider>,
  );
  const paneScroller = pane ? installScroller(ui.getByTestId('pane'), pane) : null;
  const containers: ScrollerModel[] = [];
  for (let i = 0; i < count; i++) {
    const container = ui.getByTestId(`node-${i}`).querySelector<HTMLElement>('.c4-diagram-container')!;
    const left = cfg.left ?? 0;
    const width = cfg.width ?? 1000;
    containers.push(
      installScroller(container, { maxLeft: cfg.maxLeft, left: cfg.scrollLeft }),
    );
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(container, 'scrollWidth', { configurable: true, value: cfg.scrollWidth ?? width });
    container.getBoundingClientRect = () =>
      ({ left, top: 0, right: left + width, bottom: 500, width, height: 500, x: left, y: 0, toJSON() {} });
    // Enter layout mode.
    fireEvent.mouseEnter(container);
    fireEvent.click(container.querySelector('button[aria-label="Edit layout"]')!);
  }
  return { ...ui, docScroller, paneScroller, containers };
}

function rect(ctl: FakeControls) {
  const r = ctl.svg().getBoundingClientRect();
  return { x: r.left, y: r.top };
}

/** Drives one drag and returns the dropped svg's screen position just before and just after release. */
function dragAndRelease(
  ctl: FakeControls,
  growth: Shift[],
  opts: { deferred?: Shift } = {},
) {
  act(() => ctl.start());
  for (const g of growth) act(() => ctl.grow(g));
  const before = rect(ctl);
  act(() => ctl.release(opts.deferred));
  return { before, after: rect(ctl) };
}

function expectStill(before: { x: number; y: number }, after: { x: number; y: number }) {
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
}

const allScrollCalls = () => registry.scrollers.reduce((n, m) => n + m.scrollTo.mock.calls.length, 0);

describe('C4 node release-shift compensation', () => {
  describe('vertical growth is cancelled by scrolling, never by a translate', () => {
    it('top growth: scrolls the document down by the growth; node still; no translate', () => {
      const { docScroller } = renderNodes({ doc: { maxTop: 5000, top: 200 } });
      const { before, after } = dragAndRelease(registry.controls[0], [{ x: 0, y: 35 }]);
      expectStill(before, after);
      expect(docScroller.top).toBe(235);
      expect(registry.controls[0].svg().style.translate).toBe('');
      // Guard against a vacuous pass: the renderer really did move the origin.
      expect(registry.controls[0].origin.y).toBe(95);
    });

    it('works in a document that is already scrolled a long way', () => {
      const { docScroller } = renderNodes({ doc: { maxTop: 9000, top: 4000 } });
      const { before, after } = dragAndRelease(registry.controls[0], [{ x: 0, y: 48 }]);
      expectStill(before, after);
      expect(docScroller.top).toBe(4048);
    });

    it("scrolls the editor's own scroller, not the document, when there is one", () => {
      const { docScroller, paneScroller } = renderNodes({
        doc: { maxTop: 5000, top: 100 },
        pane: { maxTop: 800, top: 300 },
      });
      const { before, after } = dragAndRelease(registry.controls[0], [{ x: 0, y: 40 }]);
      expectStill(before, after);
      expect(paneScroller!.top).toBe(340);
      expect(docScroller.top).toBe(100);
      expect(docScroller.scrollTo).not.toHaveBeenCalled();
    });

    it('with no scroll range accepts the shift: no translate, nothing clipped to avoid it', () => {
      renderNodes({ doc: { maxTop: 0, top: 0 } });
      const ctl = registry.controls[0];
      const { before, after } = dragAndRelease(ctl, [{ x: 0, y: 35 }]);
      expect(after.y - before.y).toBe(35);
      expect(after.x).toBe(before.x);
      expect(ctl.svg().style.translate).toBe('');
    });

    it('with a partial range compensates as far as it goes and accepts the rest', () => {
      const { docScroller } = renderNodes({ doc: { maxTop: 210, top: 200 } });
      const ctl = registry.controls[0];
      const { before, after } = dragAndRelease(ctl, [{ x: 0, y: 35 }]);
      expect(docScroller.top).toBe(210);
      expect(after.y - before.y).toBe(25);
      expect(ctl.svg().style.translate).toBe('');
    });

    it('falls back to assigning scrollTop where scrollTo is unavailable', () => {
      const { docScroller } = renderNodes({ doc: { maxTop: 5000, top: 200 } });
      Object.defineProperty(document.documentElement, 'scrollTo', { configurable: true, value: undefined });
      const { before, after } = dragAndRelease(registry.controls[0], [{ x: 0, y: 35 }]);
      expectStill(before, after);
      expect(docScroller.top).toBe(235);
    });

    it('uses `instant` scrolling so a host scroll-behavior cannot defer it', () => {
      const { docScroller } = renderNodes();
      dragAndRelease(registry.controls[0], [{ x: 0, y: 20 }]);
      expect(docScroller.scrollTo).toHaveBeenCalledWith({ top: 220, behavior: 'instant' });
    });
  });

  describe('horizontal growth', () => {
    it('centred diagram with spare width: translates to cancel left growth', () => {
      renderNodes();
      const ctl = registry.controls[0];
      const { before, after } = dragAndRelease(ctl, [{ x: 80, y: 0 }]);
      expectStill(before, after);
      expect(ctl.origin.x).toBe(180);
      expect(parsePx(ctl.svg().style.translate)).toEqual({ x: -80, y: 0 });
    });

    it('centred diagram: right growth (the centring half-growth) is translated back', () => {
      renderNodes();
      // 90px of rightward growth moves a centred diagram's origin left by 45.
      const { before, after } = dragAndRelease(registry.controls[0], [{ x: -45, y: 0 }]);
      expectStill(before, after);
      expect(parsePx(registry.controls[0].svg().style.translate).x).toBe(45);
    });

    it('overflowing content: cancels with the container scrollLeft, no translate', () => {
      const { containers } = renderNodes({
        container: { width: 1000, scrollWidth: 1500, maxLeft: 500, scrollLeft: 100 },
      });
      const ctl = registry.controls[0];
      const { before, after } = dragAndRelease(ctl, [{ x: 80, y: 0 }]);
      expectStill(before, after);
      expect(containers[0].left).toBe(180);
      expect(ctl.svg().style.translate).toBe('');
    });

    it('overflowing content with only partial scroll range: scrolls what it can, translates the rest', () => {
      const { containers } = renderNodes({
        container: { width: 1000, scrollWidth: 1500, maxLeft: 130, scrollLeft: 100 },
      });
      const ctl = registry.controls[0];
      const { before, after } = dragAndRelease(ctl, [{ x: 80, y: 0 }]);
      expectStill(before, after);
      expect(containers[0].left).toBe(130);
      expect(parsePx(ctl.svg().style.translate).x).toBe(-50);
    });

    it('never translates content past the container edge: clamps, accepting the rest as a shift', () => {
      // Dropped just beyond the container's right edge (300).
      registry.baseOrigin = { x: 295, y: 60 };
      renderNodes({ container: { left: 0, width: 300 } });
      const ctl = registry.controls[0];
      const { before, after } = dragAndRelease(ctl, [{ x: -60, y: 0 }]);
      // Cancelling fully would put the svg at 295..305; it stops at the edge.
      expect(parsePx(ctl.svg().style.translate).x).toBe(55);
      expect(after.x + registry.svgWidth).toBeLessThanOrEqual(300);
      expect(after.x - before.x).toBe(-5);
    });

    it('accepts the shift when the svg is wider than the container', () => {
      registry.svgWidth = 400;
      renderNodes({ container: { left: 0, width: 300 } });
      const ctl = registry.controls[0];
      const { before, after } = dragAndRelease(ctl, [{ x: 80, y: 0 }]);
      expect(after.x - before.x).toBe(80);
      expect(ctl.svg().style.translate).toBe('');
    });

    it('applies vertical and horizontal rules independently for a corner drop', () => {
      const { docScroller } = renderNodes();
      const ctl = registry.controls[0];
      const { before, after } = dragAndRelease(ctl, [{ x: 40, y: 25 }]);
      expectStill(before, after);
      expect(docScroller.top).toBe(225);
      expect(parsePx(ctl.svg().style.translate)).toEqual({ x: -40, y: 0 });
    });

    it('corner drop with no vertical range still cancels horizontally', () => {
      renderNodes({ doc: { maxTop: 0 } });
      const ctl = registry.controls[0];
      const { before, after } = dragAndRelease(ctl, [{ x: 40, y: 25 }]);
      expect(after.x).toBe(before.x);
      expect(after.y - before.y).toBe(25);
    });
  });

  it('handles fractional shifts within 1px', () => {
    renderNodes();
    const { before, after } = dragAndRelease(registry.controls[0], [{ x: 12.5, y: 0.25 }]);
    expectStill(before, after);
  });

  it('uses the net growth when it is smaller than the peak', () => {
    renderNodes();
    const { before, after } = dragAndRelease(registry.controls[0], [
      { x: 60, y: 30 },
      { x: 5, y: 2 },
    ]);
    expectStill(before, after);
  });

  it('works when the container was already scrolled horizontally at drag start', () => {
    registry.baseOrigin = { x: 100 + 140, y: 60 };
    renderNodes({ container: { width: 1000, scrollWidth: 1500, maxLeft: 500, scrollLeft: 140 } });
    const { before, after } = dragAndRelease(registry.controls[0], [{ x: 33, y: 0 }]);
    expectStill(before, after);
  });

  it('compensates growth that only lands at release (cap-deferred), with onFrameChange silent', () => {
    renderNodes();
    const { before, after } = dragAndRelease(registry.controls[0], [], {
      deferred: { x: 70, y: 20 },
    });
    expectStill(before, after);
    expect(registry.controls[0].onFrameChangeProp).toBeUndefined();
  });

  it('accumulates the horizontal offset across successive drags', () => {
    renderNodes();
    const ctl = registry.controls[0];
    const first = dragAndRelease(ctl, [{ x: 30, y: 10 }]);
    expectStill(first.before, first.after);
    const second = dragAndRelease(ctl, [{ x: 50, y: 0 }]);
    expectStill(second.before, second.after);
    expect(parsePx(ctl.svg().style.translate).x).toBeLessThan(-30);
  });

  it('changes nothing for a drag that does not grow the frame', () => {
    const { docScroller, containers } = renderNodes();
    const ctl = registry.controls[0];
    const { before, after } = dragAndRelease(ctl, []);
    expect(after).toEqual(before);
    expect(ctl.svg().style.translate).toBe('');
    expect(allScrollCalls()).toBe(0);
    expect(docScroller.top).toBe(200);
    expect(containers[0].left).toBe(0);
  });

  it('applies nothing during the drag, only at release', () => {
    const { docScroller } = renderNodes();
    const ctl = registry.controls[0];
    act(() => ctl.start());
    act(() => ctl.grow({ x: 60, y: 40 }));
    expect(ctl.svg().style.translate).toBe('');
    expect(allScrollCalls()).toBe(0);
    act(() => ctl.release());
    expect(ctl.svg().style.translate).not.toBe('');
    expect(docScroller.top).toBe(240);
  });

  it('leaves nothing behind when a drag is cancelled', () => {
    renderNodes();
    const ctl = registry.controls[0];
    act(() => ctl.start());
    act(() => ctl.grow({ x: 60, y: 40 }));
    act(() => ctl.cancel());
    expect(ctl.svg().style.translate).toBe('');
    expect(allScrollCalls()).toBe(0);
    expect(rect(ctl)).toEqual({ x: registry.baseOrigin.x, y: registry.baseOrigin.y - 200 });
    // A later growth-free release must not apply a stale snapshot.
    const { before, after } = dragAndRelease(ctl, []);
    expect(after).toEqual(before);
    expect(ctl.svg().style.translate).toBe('');
    expect(allScrollCalls()).toBe(0);
  });

  it('compensates two C4 nodes in one document independently', () => {
    renderNodes({ count: 2 });
    const [a, b] = registry.controls;
    const first = dragAndRelease(a, [{ x: 50, y: 0 }]);
    expectStill(first.before, first.after);
    expect(b.svg().style.translate).toBe('');
    const second = dragAndRelease(b, [{ x: 0, y: 30 }]);
    expectStill(second.before, second.after);
    expect(parsePx(a.svg().style.translate)).toEqual({ x: -50, y: 0 });
    expect(b.svg().style.translate).toBe('');
  });

  it('starts clean after layout mode is exited and re-entered', () => {
    const ui = renderNodes();
    dragAndRelease(registry.controls[0], [{ x: 50, y: 20 }]);
    const container = ui.getByTestId('node-0').querySelector('.c4-diagram-container')!;
    fireEvent.click(container.querySelector('button[aria-label="Exit layout mode"]')!);
    fireEvent.click(container.querySelector('button[aria-label="Edit layout"]')!);
    const ctl = registry.controls[registry.controls.length - 1];
    expect(ctl.svg().style.translate).toBe('');
  });

  it('keeps scroll anchoring off and centres safely so overflow stays reachable', () => {
    const ui = renderNodes();
    const container = ui.getByTestId('node-0').querySelector<HTMLElement>('.c4-diagram-container')!;
    expect(container.style.overflowAnchor).toBe('none');
    expect(container.style.justifyContent).toBe('safe center');
  });

  it('does not pass `zoom` to the renderer (the 48px growth cap needs zoom-to-fit)', () => {
    // If a later change passes `zoom`, the renderer's growth cap can engage and
    // defer growth to release. The fix copes (see the deferred test above), but
    // ADR-203's cap analysis must be re-checked — so fail loudly.
    renderNodes();
    expect(registry.controls[0].zoomProp).toBeUndefined();
  });
});
