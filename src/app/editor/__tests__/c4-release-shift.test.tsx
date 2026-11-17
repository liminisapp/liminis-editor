/**
 * C4 node: while a node is dragged past the top or left edge the host absorbs the
 * renderer's origin shift live, and never clips anything (ADR-203 as amended for
 * #206 twice; liminis-diagrams#110, `@liminis/diagrams` >= 0.2.2).
 *
 * The host opts out of the renderer's hold transform (`holdOrigin={false}`), so the
 * svg's layout box is the whole drawing and nothing is painted outside it. The
 * renderer then reports `onOriginShift({ dx, dy })` from its layout effect on every
 * frame in which the origin moves. The host:
 *   - scrolls the nearest vertical scroller (or the document) by `dy`, and accepts
 *     whatever the scroll range cannot absorb;
 *   - scrolls the container by `dx`, which is a no-op while the svg shrinks to fit;
 *   - writes no `transform` or `translate` on the svg at any point.
 *
 * happy-dom has no layout, so the renderer, the geometry and the scrollers are
 * faked, but built to be able to fail the way the real thing does:
 *   - the geometry is non-identity (a base offset, pre-scrolled scrollers);
 *   - the fake renderer reports the shift from a CHILD layout effect, as the real
 *     one does, and reports the reverse shift on a cancelled drag;
 *   - scrollers clamp to their range, and the svg's rect subtracts every scroll offset.
 * Real pixels and the clipping itself are the e2e's job.
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
  /** Natural origin of the diagram's svg on screen, before any scrolling. */
  origin: { x: number; y: number };
  holdOriginProp: unknown;
  hasOriginShiftProp: boolean;
  zoomProp: unknown;
  start(): void;
  /** The frame has grown so the origin is now `shift` from where the drag began. */
  grow(shift: Shift): void;
  release(): void;
  cancel(): void;
  svg(): SVGSVGElement;
}

const registry = vi.hoisted(() => ({
  controls: [] as FakeControls[],
  bySvg: new WeakMap<Element, FakeControls>(),
  baseOrigin: { x: 100, y: 60 },
  scrollers: [] as ScrollerModel[],
  onPositionChange: vi.fn(),
}));

vi.mock('@liminis/diagrams/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@liminis/diagrams/react')>();
  const React = await import('react');

  function FakeInteractiveRenderer(props: {
    onPositionChange: (p: Record<string, { x: number; y: number }>) => void;
    zoom?: unknown;
    holdOrigin?: boolean;
    onOriginShift?: (s: { dx: number; dy: number }) => void;
  }) {
    const { useState, useRef, useLayoutEffect } = React;
    const [dragging, setDragging] = useState(false);
    const [, force] = useState(0);
    const svgRef = useRef<SVGSVGElement>(null);
    const propsRef = useRef(props);
    propsRef.current = props;
    const self = useRef<FakeControls | null>(null);
    const reported = useRef({ ...registry.baseOrigin });
    const wasDragging = useRef(false);

    if (!self.current) {
      self.current = {
        origin: { ...registry.baseOrigin },
        holdOriginProp: undefined,
        hasOriginShiftProp: false,
        zoomProp: undefined,
        start: () => setDragging(true),
        grow: (s) => {
          self.current!.origin = {
            x: registry.baseOrigin.x + s.x,
            y: registry.baseOrigin.y + s.y,
          };
          force((n) => n + 1);
        },
        release: () => {
          propsRef.current.onPositionChange({ a: { x: 1, y: 1 } });
          registry.onPositionChange();
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
    self.current.holdOriginProp = props.holdOrigin;
    self.current.hasOriginShiftProp = typeof props.onOriginShift === 'function';

    // Mirrors the renderer with `holdOrigin={false}`: from a layout effect, in the
    // commit that changes the frame, report the displacement since the previous
    // commit while dragging (and in the commit that ends a cancelled drag).
    useLayoutEffect(() => {
      const svg = svgRef.current;
      if (!svg) return;
      registry.bySvg.set(svg, self.current!);
      const cur = self.current!.origin;
      const dx = cur.x - reported.current.x;
      const dy = cur.y - reported.current.y;
      reported.current = { ...cur };
      const inDrag = dragging || wasDragging.current;
      wasDragging.current = dragging;
      if (propsRef.current.holdOrigin === false && inDrag && (dx !== 0 || dy !== 0)) {
        propsRef.current.onOriginShift?.({ dx, dy });
      }
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
  // Real engines snap a scroll position to whole device pixels.
  m.scrollTo.mockImplementation((o: { top?: number; left?: number }) => {
    if (o.top !== undefined) m.top = clamp(Math.round(o.top), m.maxTop);
    if (o.left !== undefined) m.left = clamp(Math.round(o.left), m.maxLeft);
  });
  Object.defineProperty(el, 'scrollTo', { configurable: true, value: m.scrollTo });
  registry.scrollers.push(m);
  return m;
}

beforeEach(() => {
  registry.controls.length = 0;
  registry.scrollers.length = 0;
  registry.baseOrigin = { x: 100, y: 60 };
  registry.onPositionChange.mockClear();
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
    const w = 10;
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

/** Starts a drag and applies each cumulative growth in turn, returning the svg's screen position after each. */
function drag(ctl: FakeControls, steps: Shift[]) {
  act(() => ctl.start());
  return steps.map((s) => {
    act(() => ctl.grow(s));
    return rect(ctl);
  });
}

function expectStill(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(1);
}

describe('C4 live origin-shift compensation (#206)', () => {
  it('opts out of the hold transform, absorbs the shift, and never passes zoom', () => {
    renderNodes();
    const ctl = registry.controls[0];
    expect(ctl.holdOriginProp).toBe(false);
    expect(ctl.hasOriginShiftProp).toBe(true);
    expect(ctl.zoomProp).toBeUndefined();
  });

  it('top growth: scrolls the document by dy on every frame, so the diagram stays put', () => {
    const { docScroller } = renderNodes();
    const ctl = registry.controls[0];
    const start = rect(ctl);
    const frames = drag(ctl, [{ x: 0, y: 20 }, { x: 0, y: 55 }, { x: 0, y: 120 }]);
    for (const f of frames) expectStill(f, start);
    expect(docScroller.top).toBe(200 + 120);
    act(() => ctl.release());
    expectStill(rect(ctl), start);
    expect(docScroller.top).toBe(320); // release adds nothing
  });

  it('top growth in a document scrolled a long way down', () => {
    const { docScroller } = renderNodes({ doc: { maxTop: 9000, top: 4000 } });
    const ctl = registry.controls[0];
    const start = rect(ctl);
    for (const f of drag(ctl, [{ x: 0, y: 80 }])) expectStill(f, start);
    expect(docScroller.top).toBe(4080);
  });

  it('top growth in a scrollable editor pane that is not the document: the pane scrolls, the document does not', () => {
    const { docScroller, paneScroller } = renderNodes({ pane: { maxTop: 3000, top: 100 } });
    const ctl = registry.controls[0];
    const start = rect(ctl);
    for (const f of drag(ctl, [{ x: 0, y: 70 }])) expectStill(f, start);
    expect(paneScroller!.top).toBe(170);
    expect(docScroller.top).toBe(200);
  });

  it('top growth with no scroll range: no scroll, the shift is accepted (nothing is clipped)', () => {
    const { docScroller } = renderNodes({ doc: { maxTop: 0, top: 0 } });
    const ctl = registry.controls[0];
    const start = rect(ctl);
    const [f] = drag(ctl, [{ x: 0, y: 70 }]);
    expect(docScroller.top).toBe(0);
    expect(f.y - start.y).toBe(70);
    expect(f.x).toBe(start.x);
  });

  it('top growth with partial range: compensates as far as it can, the remainder shifts', () => {
    const { docScroller } = renderNodes({ doc: { maxTop: 230, top: 200 } });
    const ctl = registry.controls[0];
    const start = rect(ctl);
    const [f] = drag(ctl, [{ x: 0, y: 70 }]);
    expect(docScroller.top).toBe(230);
    expect(f.y - start.y).toBe(40);
  });

  it('fractional shifts do not accumulate into a drift: the rounding is carried between frames', () => {
    const { docScroller } = renderNodes();
    const ctl = registry.controls[0];
    const start = rect(ctl);
    const steps = Array.from({ length: 14 }, (_, i) => ({ x: 0, y: 7.4 * (i + 1) }));
    for (const f of drag(ctl, steps)) expectStill(f, start);
    expect(docScroller.top).toBe(200 + Math.round(7.4 * 14));
  });

  it('out and back with no scroll range: the reverse shift scrolls nothing it never scrolled', () => {
    const { docScroller } = renderNodes({ doc: { maxTop: 230, top: 200 } });
    const ctl = registry.controls[0];
    const start = rect(ctl);
    drag(ctl, [{ x: 0, y: 70 }, { x: 0, y: 0 }]);
    expect(docScroller.top).toBe(200);
    act(() => ctl.release());
    expectStill(rect(ctl), start);
  });

  it('out and back: the reverse shift unwinds the scroll', () => {
    const { docScroller } = renderNodes();
    const ctl = registry.controls[0];
    const start = rect(ctl);
    drag(ctl, [{ x: 0, y: 90 }, { x: 0, y: 0 }]);
    expect(docScroller.top).toBe(200);
    act(() => ctl.release());
    expectStill(rect(ctl), start);
  });

  it('a cancelled drag undoes its compensation', () => {
    const { docScroller } = renderNodes();
    const ctl = registry.controls[0];
    const start = rect(ctl);
    drag(ctl, [{ x: 0, y: 90 }]);
    act(() => ctl.cancel());
    expect(docScroller.top).toBe(200);
    expectStill(rect(ctl), start);
    expect(registry.onPositionChange).not.toHaveBeenCalled();
  });

  it('left growth, container fits: nothing to scroll, no translate, the diagram simply re-centres', () => {
    const { containers, docScroller } = renderNodes();
    const ctl = registry.controls[0];
    drag(ctl, [{ x: 40, y: 0 }, { x: 150, y: 0 }]);
    expect(containers[0].left).toBe(0);
    expect(docScroller.top).toBe(200);
    expect(ctl.svg().style.translate).toBe('');
    expect(ctl.svg().style.transform).toBe('');
  });

  it('left growth, container overflows: its scroll position cancels the shift', () => {
    const { containers } = renderNodes({ container: { scrollWidth: 1600, maxLeft: 600, scrollLeft: 100 } });
    const ctl = registry.controls[0];
    const start = rect(ctl);
    for (const f of drag(ctl, [{ x: 60, y: 0 }])) expectStill(f, start);
    expect(containers[0].left).toBe(160);
  });

  it('corner growth: the two axes are independent', () => {
    const { containers, docScroller } = renderNodes({ container: { scrollWidth: 1600, maxLeft: 600 } });
    const ctl = registry.controls[0];
    const start = rect(ctl);
    for (const f of drag(ctl, [{ x: 30, y: 50 }])) expectStill(f, start);
    expect(containers[0].left).toBe(30);
    expect(docScroller.top).toBe(250);
  });

  it('corner growth with no vertical range still scrolls horizontally', () => {
    const { containers } = renderNodes({
      doc: { maxTop: 0, top: 0 },
      container: { scrollWidth: 1600, maxLeft: 600 },
    });
    const ctl = registry.controls[0];
    const start = rect(ctl);
    const [f] = drag(ctl, [{ x: 30, y: 50 }]);
    expect(containers[0].left).toBe(30);
    expect(f.x).toBe(start.x);
    expect(f.y - start.y).toBe(50);
  });

  it('bottom/right growth reports no shift and changes nothing', () => {
    const { containers, docScroller, paneScroller } = renderNodes({ pane: { maxTop: 3000, top: 10 } });
    const ctl = registry.controls[0];
    // The origin does not move when the frame grows at the bottom or right.
    drag(ctl, [{ x: 0, y: 0 }]);
    act(() => ctl.release());
    expect(docScroller.scrollTo).not.toHaveBeenCalled();
    expect(paneScroller!.scrollTo).not.toHaveBeenCalled();
    expect(containers[0].scrollTo).not.toHaveBeenCalled();
    expect(docScroller.top).toBe(200);
    expect(paneScroller!.top).toBe(10);
  });

  it('writes no transform or translate on the svg at any point, and none after release', () => {
    renderNodes();
    const ctl = registry.controls[0];
    act(() => ctl.start());
    for (const s of [{ x: 40, y: 70 }, { x: 90, y: 130 }]) {
      act(() => ctl.grow(s));
      expect(ctl.svg().style.transform).toBe('');
      expect(ctl.svg().style.translate).toBe('');
    }
    act(() => ctl.release());
    expect(ctl.svg().style.transform).toBe('');
    expect(ctl.svg().style.translate).toBe('');
  });

  it('keeps scroll anchoring off the container', () => {
    const { containers } = renderNodes();
    void containers;
    const container = document.querySelector<HTMLElement>('.c4-diagram-container')!;
    expect(container.style.overflowAnchor).toBe('none');
  });
});
