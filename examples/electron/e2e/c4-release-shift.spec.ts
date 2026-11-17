/**
 * Package-level e2e for #203 and #206 — a C4 node dragged past any edge of the
 * diagram must stay inside the container's visible box on EVERY frame of the drag,
 * and the diagram must not move on screen (docs/decisions/adr-203-*.md, including
 * its 2026-11-16 and 2026-11-17 amendments).
 *
 * The host opts out of `@liminis/diagrams`' hold transform (`holdOrigin={false}`,
 * >= 0.2.2), so the svg's layout box is always the whole drawing and a clipping
 * container cannot cut off the grown strip. The renderer reports the origin shift
 * live (`onOriginShift`); the host scrolls the nearest vertical scroller (or the
 * document) to cancel it, and accepts a shift where there is no scroll range.
 * Past the left or right edge the svg shrinks to fit and the diagram re-centres.
 * There is no release-time compensation and no host translate.
 *
 * The unit tests fake all geometry; only a real Chromium layout can prove the node
 * is never clipped, so every frame is checked, not only the drop.
 */
import { _electron as electron, test, expect, type ElectronApplication, type Page, type Locator } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
// Long: the document scrolls, with range above and below the diagram.
const FIXTURE = join(HERE, 'fixtures', 'c4-release-shift.md');
// Short: no vertical scroll range at all.
const FIXTURE_SHORT = join(HERE, 'fixtures', 'c4-release-shift-short.md');

const EDITOR = '[aria-label="Markdown editor"]';
const CONTAINER = '.c4-diagram-container';
const SVG = `${CONTAINER} svg[data-diagram="c4"]`;
const HIT_AREAS = `${SVG} g.interactive-layer > *`;

async function launch(fixture = FIXTURE): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [APP_DIR, '--content-file', fixture] });
  const page = await app.firstWindow();
  await page.waitForSelector(EDITOR);
  await page.waitForSelector(CONTAINER);
  await page.waitForLoadState('networkidle');
  return { app, page };
}

async function enterLayoutMode(page: Page): Promise<void> {
  await page.hover(CONTAINER);
  await page.click(`${CONTAINER} button[aria-label="Edit layout"]`);
  await page.waitForSelector(HIT_AREAS);
}

async function box(locator: Locator): Promise<{ x: number; y: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element has no bounding box');
  return { x: b.x, y: b.y };
}

/** One frame, so the renderer's rAF-throttled drag positions have landed. */
async function frames(page: Page, n = 3): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const tick = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1)));
        tick(count);
      }),
    n,
  );
}

interface Pt {
  x: number;
  y: number;
}

/** Everything measured on one frame of a drag. */
interface Frame {
  /** Fraction (0..1) of the dragged node's box inside the container's visible box. */
  visible: number;
  node: Pt;
  /** A node that is not being dragged: it must not move on screen. */
  other: Pt;
  /** Horizontal offset of the svg's centre from the container's content-box centre. */
  centreOffset: number;
  scrollY: number;
}

/** Fraction of `target`'s box inside the container's padding box and the viewport. */
async function measure(page: Page): Promise<Frame> {
  return page.evaluate(
    ({ container, svg, hit }) => {
      const c = document.querySelector(container)!;
      const hits = document.querySelectorAll(hit);
      const dragged = hits[0].getBoundingClientRect();
      const other = hits[hits.length - 1].getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      const l = Math.max(cr.left + c.clientLeft, 0);
      const t = Math.max(cr.top + c.clientTop, 0);
      const r = Math.min(cr.left + c.clientLeft + c.clientWidth, window.innerWidth);
      const b = Math.min(cr.top + c.clientTop + c.clientHeight, window.innerHeight);
      const w = Math.max(0, Math.min(dragged.right, r) - Math.max(dragged.left, l));
      const h = Math.max(0, Math.min(dragged.bottom, b) - Math.max(dragged.top, t));
      const area = dragged.width * dragged.height;
      const s = document.querySelector(svg)!.getBoundingClientRect();
      const style = getComputedStyle(c);
      const padL = parseFloat(style.paddingLeft);
      const padR = parseFloat(style.paddingRight);
      const boxCentre = cr.left + c.clientLeft + padL + (c.clientWidth - padL - padR) / 2;
      return {
        visible: area === 0 ? 0 : (w * h) / area,
        node: { x: dragged.x, y: dragged.y },
        other: { x: other.x, y: other.y },
        centreOffset: s.left + s.width / 2 - boxCentre,
        scrollY: window.scrollY,
      };
    },
    { container: CONTAINER, svg: SVG, hit: HIT_AREAS },
  );
}

/**
 * Drags the first node by `(dx, dy)` from its centre and measures EVERY frame of the
 * drag, then the frame after release.
 */
async function dragAndRelease(page: Page, dx: number, dy: number) {
  const node = page.locator(HIT_AREAS).first();
  const start = await node.boundingBox();
  if (!start) throw new Error('node has no bounding box');
  const sx = start.x + start.width / 2;
  const sy = start.y + start.height / 2;
  const initial = await measure(page);

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const steps = 14;
  const during: Frame[] = [];
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(sx + (dx * i) / steps, sy + (dy * i) / steps);
    await frames(page, 1);
    during.push(await measure(page));
  }
  await frames(page);
  const before = await measure(page);
  await page.mouse.up();
  await frames(page, 5);
  const after = await measure(page);
  return { initial, during, before, after };
}

type Drag = Awaited<ReturnType<typeof dragAndRelease>>;

/** Every node is fully inside the container's visible box on every frame, and after the drop. */
function expectNeverClipped(d: Drag): void {
  for (const f of [...d.during, d.before, d.after]) expect(f.visible).toBeGreaterThan(0.99);
}

function expectStill(before: Pt, after: Pt, tolerance = 1): void {
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(tolerance);
}

/** A node that is not being dragged does not move on screen on any frame. */
function expectOthersStill(d: Drag): void {
  for (const f of [...d.during, d.before, d.after]) expectStill(d.initial.other, f.other, 1.5);
}

/** The diagram stays centred in the container: no residual offset. */
function expectCentred(f: Frame): void {
  expect(Math.abs(f.centreOffset)).toBeLessThanOrEqual(1.5);
}

/** Scrolls the document so the diagram's top edge sits `fromTop` px below the viewport top. */
async function placeDiagram(page: Page, fromTop: number): Promise<void> {
  await page.locator(CONTAINER).evaluate((el, y) => {
    window.scrollBy(0, el.getBoundingClientRect().top - y);
  }, fromTop);
  await frames(page, 2);
}

/** Drags the node `margin`px past the diagram's top / bottom / left / right edge (measured live). */
async function overshoot(page: Page, side: 'top' | 'bottom' | 'left' | 'right', margin: number) {
  const svg = await page.locator(SVG).boundingBox();
  const node = await page.locator(HIT_AREAS).first().boundingBox();
  if (side === 'top') return { dx: 0, dy: -(node!.y - svg!.y) - margin };
  if (side === 'bottom') return { dx: 0, dy: svg!.y + svg!.height - node!.y + margin };
  if (side === 'left') return { dx: -(node!.x - svg!.x) - margin, dy: 0 };
  return { dx: svg!.x + svg!.width - node!.x + margin, dy: 0 };
}

const translateOf = (page: Page) =>
  page.locator(SVG).evaluate((el) => (el as SVGElement).style.translate);
const transformOf = (page: Page) =>
  page.locator(SVG).evaluate((el) => (el as SVGElement).style.transform);

/** Runs `body` against a fresh app, always closing it. */
async function withApp(
  fixture: string | undefined,
  body: (page: Page, app: ElectronApplication) => Promise<void>,
): Promise<void> {
  const { app, page } = await launch(fixture);
  try {
    await enterLayoutMode(page);
    await body(page, app);
  } finally {
    await app.close();
  }
}

test.describe('C4 node — live origin shift while dragging (#203, #206)', () => {
  test('top edge: never clipped on any frame, other nodes stay put, in a scrollable document', async () => {
    await withApp(undefined, async (page) => {
      await placeDiagram(page, 250);
      const { dx, dy } = await overshoot(page, 'top', 60);
      const d = await dragAndRelease(page, dx, dy);
      expectNeverClipped(d);
      expectOthersStill(d);
      expectStill(d.before.node, d.after.node);
      // Cancelled by scrolling the document, never by a transform or translate.
      expect(d.after.scrollY).toBeGreaterThan(d.initial.scrollY);
      expect(await translateOf(page)).toBe('');
      expect(await transformOf(page)).toBe('');
      expectCentred(d.after);
    });
  });

  test('top edge: the same in a document scrolled a long way down', async () => {
    await withApp(undefined, async (page) => {
      await placeDiagram(page, 300);
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
      const { dx, dy } = await overshoot(page, 'top', 90);
      const d = await dragAndRelease(page, dx, dy);
      expectNeverClipped(d);
      expectOthersStill(d);
      expectStill(d.before.node, d.after.node);
    });
  });

  test('top edge: the same in a scrollable pane that is not the document', async () => {
    await withApp(undefined, async (page) => {
      // Turn the editor's parent into a bounded, scrolling pane.
      await page.evaluate((editor) => {
        const pane = document.querySelector(editor)!.parentElement!;
        pane.id = 'e2e-scroll-pane';
        pane.style.height = '500px';
        pane.style.overflowY = 'auto';
      }, EDITOR);
      await page.locator(CONTAINER).evaluate((el) => {
        const pane = document.getElementById('e2e-scroll-pane')!;
        pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top - 220;
      });
      await frames(page, 2);
      const paneTop = () => page.evaluate(() => document.getElementById('e2e-scroll-pane')!.scrollTop);
      const paneBefore = await paneTop();
      expect(paneBefore).toBeGreaterThan(0);
      const { dx, dy } = await overshoot(page, 'top', 60);
      const d = await dragAndRelease(page, dx, dy);
      expectNeverClipped(d);
      expectOthersStill(d);
      expectStill(d.before.node, d.after.node);
      expect(await paneTop()).toBeGreaterThan(paneBefore);
    });
  });

  test('top edge, short document with no scroll range: never clipped, the shift is allowed', async () => {
    await withApp(FIXTURE_SHORT, async (page, app) => {
      // Even this short document scrolls a little in the default window (editor
      // chrome); make the window tall enough that there is no range at all.
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setSize(1100, 2000);
      });
      await page.waitForFunction(() => window.innerHeight >= 1500);
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
      ).toBeLessThanOrEqual(0);
      const { dx, dy } = await overshoot(page, 'top', 60);
      const d = await dragAndRelease(page, dx, dy);
      expectNeverClipped(d);
      expect(d.after.scrollY).toBe(d.initial.scrollY);
    });
  });

  test('bottom edge behaves like the top: never clipped, nothing else moves', async () => {
    await withApp(undefined, async (page, app) => {
      // Tall enough that the whole grown diagram fits the viewport: a node dropped
      // below the fold is off screen, which is not what this test is about.
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setSize(1100, 2000);
      });
      await page.waitForFunction(() => window.innerHeight >= 1500);
      await placeDiagram(page, 150);
      const { dx, dy } = await overshoot(page, 'bottom', 60);
      const d = await dragAndRelease(page, dx, dy);
      expectNeverClipped(d);
      expectOthersStill(d);
      expectStill(d.before.node, d.after.node);
      expect(d.after.scrollY).toBe(d.initial.scrollY);
    });
  });

  test('left edge: never clipped on any frame, the diagram stays centred and shrinks to fit', async () => {
    await withApp(undefined, async (page) => {
      await placeDiagram(page, 250);
      const { dx, dy } = await overshoot(page, 'left', 100);
      const d = await dragAndRelease(page, dx, dy);
      expectNeverClipped(d);
      for (const f of [...d.during, d.after]) expectCentred(f);
      expect(await translateOf(page)).toBe('');
      expect(await transformOf(page)).toBe('');
      // The drawing never spills past the container.
      const spill = await page.evaluate(
        ([c, s]) => {
          const cr = document.querySelector(c)!.getBoundingClientRect();
          const sr = document.querySelector(s)!.getBoundingClientRect();
          return Math.max(cr.left - sr.left, sr.right - cr.right);
        },
        [CONTAINER, SVG],
      );
      expect(spill).toBeLessThanOrEqual(1);
    });
  });

  test('right edge: the same as the left, symmetrically', async () => {
    await withApp(undefined, async (page) => {
      await placeDiagram(page, 250);
      const { dx, dy } = await overshoot(page, 'right', 100);
      const d = await dragAndRelease(page, dx, dy);
      expectNeverClipped(d);
      for (const f of [...d.during, d.after]) expectCentred(f);
      expect(await translateOf(page)).toBe('');
    });
  });

  test('corners: never clipped, each axis independent, no residual translate', async () => {
    await withApp(undefined, async (page) => {
      await placeDiagram(page, 250);
      const h = await overshoot(page, 'left', 100);
      const v = await overshoot(page, 'top', 60);
      const d = await dragAndRelease(page, h.dx, v.dy);
      expectNeverClipped(d);
      expectStill(d.before.node, d.after.node);
      expect(await translateOf(page)).toBe('');
    });
  });

  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    test(`out and back at the ${side} edge leaves the diagram centred, with no leftover offset`, async () => {
      await withApp(undefined, async (page) => {
        await placeDiagram(page, 250);
        const { dx, dy } = await overshoot(page, side, 80);
        const initial = await measure(page);
        const node = await page.locator(HIT_AREAS).first().boundingBox();
        const sx = node!.x + node!.width / 2;
        const sy = node!.y + node!.height / 2;
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        for (let i = 1; i <= 12; i++) {
          await page.mouse.move(sx + (dx * i) / 12, sy + (dy * i) / 12);
          await frames(page, 1);
        }
        for (let i = 11; i >= 0; i--) {
          await page.mouse.move(sx + (dx * i) / 12, sy + (dy * i) / 12);
          await frames(page, 1);
        }
        await frames(page, 3);
        const f = await measure(page);
        expect(f.visible).toBeGreaterThan(0.99);
        expectCentred(f);
        expect(Math.abs(f.scrollY - initial.scrollY)).toBeLessThanOrEqual(1.5);
        expect(await translateOf(page)).toBe('');
        await page.mouse.up();
        await frames(page, 4);
        expect(await translateOf(page)).toBe('');
      });
    });
  }

  test('a second growing drag also holds', async () => {
    await withApp(undefined, async (page) => {
      await placeDiagram(page, 250);
      const first = await overshoot(page, 'top', 60);
      const d1 = await dragAndRelease(page, first.dx, first.dy);
      expectNeverClipped(d1);
      expectStill(d1.before.node, d1.after.node);
      const second = await overshoot(page, 'top', 40);
      const d2 = await dragAndRelease(page, second.dx, second.dy);
      expectNeverClipped(d2);
      expectStill(d2.before.node, d2.after.node);
    });
  });

  test('a drag inside the frame changes nothing: no scroll change, no offset', async () => {
    await withApp(undefined, async (page) => {
      await placeDiagram(page, 250);
      const scrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
      const leftBefore = await page.locator(CONTAINER).evaluate((el) => el.scrollLeft);
      const d = await dragAndRelease(page, 12, 8);
      expectNeverClipped(d);
      expectStill(d.before.node, d.after.node);
      expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(scrollBefore);
      expect(await page.locator(CONTAINER).evaluate((el) => el.scrollLeft)).toBe(leftBefore);
      expect(await translateOf(page)).toBe('');
    });
  });
});
