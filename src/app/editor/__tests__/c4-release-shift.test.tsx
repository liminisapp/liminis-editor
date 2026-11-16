/**
 * C4 node: the dropped node must not jump when a frame-growing drag is released
 * (ADR-203, issue #203).
 *
 * `@liminis/diagrams` 0.2.0 holds the diagram's origin steady during a drag with
 * an imperative `style.transform`, and clears it on release; the origin then jumps
 * by however much the frame grew (and, in this centring container, by half the
 * growth on the right). The host's job is to cancel that jump.
 *
 * happy-dom has no layout, so the renderer and the geometry are faked — but the
 * fake is built to be able to fail the way the real thing does:
 *   - the geometry is non-identity (a base offset, a pre-scrolled container), since
 *     identity stubs cannot fail on this bug;
 *   - the fake renderer clears `style.transform` in a CHILD layout effect, so the
 *     child-before-parent effect ordering the fix relies on is locked in;
 *   - `onPositionChange` fires at release, before the transform is cleared, and
 *     never for a cancelled drag, as in the 0.2.0 renderer.
 * Real pixel accuracy is the e2e's job; see ADR-203.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { createEditor, $getRoot } from 'lexical';
import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import C4Component from '../nodes/C4Component';
import { C4Node, $createC4Node } from '../nodes/C4Node';

interface Shift {
  /** How far the diagram's natural origin moves when the renderer adopts the grown frame. */
  x: number;
  y: number;
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
            x: registry.baseOrigin.x - s.x,
            y: registry.baseOrigin.y - s.y,
          };
          force((n) => n + 1);
        },
        release: (deferred) => {
          propsRef.current.onPositionChange({ a: { x: 1, y: 1 } });
          if (deferred) {
            self.current!.origin = {
              x: registry.baseOrigin.x - deferred.x,
              y: registry.baseOrigin.y - deferred.y,
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

beforeEach(() => {
  registry.controls.length = 0;
  registry.baseOrigin = { x: 100, y: 60 };
  // Real engines include CSS transform and translate in the bounding box.
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const ctl = registry.bySvg.get(this);
    if (!ctl) return callOriginalRect(this);
    const el = this as SVGSVGElement;
    const t = parsePx(el.style.transform);
    const tr = parsePx(el.style.translate);
    const left = ctl.origin.x + t.x + tr.x;
    const top = ctl.origin.y + t.y + tr.y;
    return { left, top, right: left + 10, bottom: top + 10, width: 10, height: 10, x: left, y: top, toJSON() {} };
  };
});

afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
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

function renderNodes(count = 1) {
  const { editor, key } = makeEditor();
  const ui = render(
    <LexicalComposerContext.Provider value={[editor, { getTheme: () => null }]}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} data-testid={`node-${i}`}>
          <C4Component code={CODE} nodeKey={key} />
        </div>
      ))}
    </LexicalComposerContext.Provider>,
  );
  // Enter layout mode on every node.
  for (let i = 0; i < count; i++) {
    const container = ui.getByTestId(`node-${i}`).querySelector('.c4-diagram-container')!;
    fireEvent.mouseEnter(container);
    fireEvent.click(container.querySelector('button[aria-label="Edit layout"]')!);
  }
  return ui;
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

describe('C4 node release-shift compensation', () => {
  it('keeps the dropped node still after growth past the left edge', () => {
    renderNodes();
    const { before, after } = dragAndRelease(registry.controls[0], [{ x: 80, y: 0 }]);
    expectStill(before, after);
    // Guard against a vacuous pass: the renderer really did move the origin.
    expect(registry.controls[0].origin.x).toBe(20);
  });

  it('keeps the dropped node still after growth past the top edge', () => {
    renderNodes();
    const { before, after } = dragAndRelease(registry.controls[0], [{ x: 0, y: 35 }]);
    expectStill(before, after);
  });

  it('keeps the dropped node still after growth past a corner', () => {
    renderNodes();
    const { before, after } = dragAndRelease(registry.controls[0], [{ x: 40, y: 25 }]);
    expectStill(before, after);
  });

  it('keeps the dropped node still after right-edge growth (the centring half-growth)', () => {
    renderNodes();
    // 90px of rightward growth moves a centred diagram's origin left by 45.
    const { before, after } = dragAndRelease(registry.controls[0], [{ x: 45, y: 0 }]);
    expectStill(before, after);
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

  it('works when the container was already scrolled at drag start', () => {
    registry.baseOrigin = { x: 100 - 140, y: 60 };
    renderNodes();
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

  it('accumulates across successive drags', () => {
    renderNodes();
    const ctl = registry.controls[0];
    const first = dragAndRelease(ctl, [{ x: 30, y: 10 }]);
    expectStill(first.before, first.after);
    const second = dragAndRelease(ctl, [{ x: 50, y: 0 }]);
    expectStill(second.before, second.after);
  });

  it('changes nothing for a drag that does not grow the frame', () => {
    renderNodes();
    const ctl = registry.controls[0];
    const { before, after } = dragAndRelease(ctl, []);
    expect(after).toEqual(before);
    expect(ctl.svg().style.translate).toBe('');
  });

  it('applies nothing during the drag, only at release', () => {
    renderNodes();
    const ctl = registry.controls[0];
    act(() => ctl.start());
    act(() => ctl.grow({ x: 60, y: 40 }));
    expect(ctl.svg().style.translate).toBe('');
    act(() => ctl.release());
    expect(ctl.svg().style.translate).not.toBe('');
  });

  it('leaves nothing behind when a drag is cancelled', () => {
    renderNodes();
    const ctl = registry.controls[0];
    act(() => ctl.start());
    act(() => ctl.grow({ x: 60, y: 40 }));
    act(() => ctl.cancel());
    expect(ctl.svg().style.translate).toBe('');
    expect(rect(ctl)).toEqual(registry.baseOrigin);
    // A later growth-free release must not apply a stale snapshot.
    const { before, after } = dragAndRelease(ctl, []);
    expect(after).toEqual(before);
    expect(ctl.svg().style.translate).toBe('');
  });

  it('compensates two C4 nodes in one document independently', () => {
    renderNodes(2);
    const [a, b] = registry.controls;
    const first = dragAndRelease(a, [{ x: 50, y: 0 }]);
    expectStill(first.before, first.after);
    expect(b.svg().style.translate).toBe('');
    const second = dragAndRelease(b, [{ x: 0, y: 30 }]);
    expectStill(second.before, second.after);
    expect(parsePx(a.svg().style.translate)).toEqual({ x: 50, y: 0 });
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

  it('does not pass `zoom` to the renderer (the 48px growth cap needs zoom-to-fit)', () => {
    // If a later change passes `zoom`, the renderer's growth cap can engage and
    // defer growth to release. The fix copes (see the deferred test above), but
    // ADR-203's cap analysis must be re-checked — so fail loudly.
    renderNodes();
    expect(registry.controls[0].zoomProp).toBeUndefined();
  });
});
