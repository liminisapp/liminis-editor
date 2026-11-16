/**
 * Package-level e2e for #203 and #206 — the C4 node must not jump when a node is
 * released after a drag that grew the diagram's frame, and must never end up
 * clipped (docs/decisions/adr-203-*.md, including its 2026-11-16 amendment).
 *
 * `@liminis/diagrams` holds the diagram's origin steady while a node is dragged
 * out, then drops that hold on release, so the origin jumps by the growth — and, in
 * this editor's centring container, by half the growth on the right. The host
 * cancels the jump: vertically by scrolling the nearest vertical scroller (a
 * translate would push the grown strip above the container's clipping edge, which
 * is what #206 fixed), horizontally by a clamped translate. The unit tests fake all
 * geometry; only a real Chromium layout can prove the node stays within 1px AND
 * that its whole box lies inside the visible area — so every drop is checked for both.
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

/**
 * Drags the first node by `(dx, dy)` from its centre, measures its on-screen
 * position just before and just after release.
 */
async function dragAndRelease(page: Page, dx: number, dy: number) {
  const node = page.locator(HIT_AREAS).first();
  const start = await node.boundingBox();
  if (!start) throw new Error('node has no bounding box');
  const sx = start.x + start.width / 2;
  const sy = start.y + start.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(sx + (dx * i) / steps, sy + (dy * i) / steps);
    await frames(page, 1);
  }
  await frames(page);
  const before = await box(node);
  await page.mouse.up();
  await frames(page, 5);
  const after = await box(node);
  return { before, after };
}

/**
 * The fraction (0..1) of the first node's box that is actually visible: inside the
 * viewport and inside every ancestor that clips it (any non-`visible` overflow),
 * including the diagram container itself. A node the container clips fails this.
 */
async function visibleFraction(page: Page): Promise<number> {
  return page.evaluate(
    ({ hit }) => {
      const el = document.querySelector(hit);
      if (!el) throw new Error('node not found');
      const r = el.getBoundingClientRect();
      let l = Math.max(r.left, 0);
      let t = Math.max(r.top, 0);
      let rr = Math.min(r.right, window.innerWidth);
      let b = Math.min(r.bottom, window.innerHeight);
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        const clipsX = cs.overflowX !== 'visible';
        const clipsY = cs.overflowY !== 'visible';
        if (!clipsX && !clipsY) continue;
        const ar = a.getBoundingClientRect();
        if (clipsX) {
          l = Math.max(l, ar.left + a.clientLeft);
          rr = Math.min(rr, ar.left + a.clientLeft + a.clientWidth);
        }
        if (clipsY) {
          t = Math.max(t, ar.top + a.clientTop);
          b = Math.min(b, ar.top + a.clientTop + a.clientHeight);
        }
      }
      const area = r.width * r.height;
      return area === 0 ? 0 : (Math.max(0, rr - l) * Math.max(0, b - t)) / area;
    },
    { hit: HIT_AREAS },
  );
}

/** Asserts the dropped node is fully visible (a 0.5px tolerance for sub-pixel layout). */
async function expectFullyVisible(page: Page): Promise<void> {
  expect(await visibleFraction(page)).toBeGreaterThan(0.99);
}

/** Scrolls the document so the diagram's top edge sits `fromTop` px below the viewport top. */
async function placeDiagram(page: Page, fromTop: number): Promise<void> {
  await page.locator(CONTAINER).evaluate((el, y) => {
    window.scrollBy(0, el.getBoundingClientRect().top - y);
  }, fromTop);
  await frames(page, 2);
}

function expectStill(before: { x: number; y: number }, after: { x: number; y: number }): void {
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
}

/** Drags the node `margin`px past the diagram's top / left / right edge (measured live). */
async function overshoot(page: Page, side: 'top' | 'left' | 'right', margin: number) {
  const svg = await page.locator(SVG).boundingBox();
  const node = await page.locator(HIT_AREAS).first().boundingBox();
  if (side === 'top') return { dx: 0, dy: -(node!.y - svg!.y) - margin };
  if (side === 'left') return { dx: -(node!.x - svg!.x) - margin, dy: 0 };
  return { dx: svg!.x + svg!.width - node!.x + margin, dy: 0 };
}

test.describe('C4 node — release shift after a frame-growing drag (#203, #206)', () => {
  test('top edge: fully visible, and still, in a scrollable document', async () => {
    const { app, page } = await launch();
    try {
      await enterLayoutMode(page);
      await placeDiagram(page, 250);
      const { dx, dy } = await overshoot(page, 'top', 60);
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const { before, after } = await dragAndRelease(page, dx, dy);
      expectStill(before, after);
      await expectFullyVisible(page);
      // The jump was cancelled by scrolling the document, not by translating.
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);
      expect(await page.locator(SVG).evaluate((el) => (el as SVGElement).style.translate)).toBe('');
    } finally {
      await app.close();
    }
  });

  test('top edge: the same in a document scrolled a long way down', async () => {
    const { app, page } = await launch();
    try {
      await enterLayoutMode(page);
      await placeDiagram(page, 300);
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
      const { dx, dy } = await overshoot(page, 'top', 90);
      const { before, after } = await dragAndRelease(page, dx, dy);
      expectStill(before, after);
      await expectFullyVisible(page);
    } finally {
      await app.close();
    }
  });

  test('top edge: the same in a scrollable pane that is not the document', async () => {
    const { app, page } = await launch();
    try {
      await enterLayoutMode(page);
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
      const paneBefore = await page.evaluate(() => document.getElementById('e2e-scroll-pane')!.scrollTop);
      expect(paneBefore).toBeGreaterThan(0);
      const { dx, dy } = await overshoot(page, 'top', 60);
      const { before, after } = await dragAndRelease(page, dx, dy);
      expectStill(before, after);
      await expectFullyVisible(page);
      expect(await page.evaluate(() => document.getElementById('e2e-scroll-pane')!.scrollTop)).toBeGreaterThan(paneBefore);
    } finally {
      await app.close();
    }
  });

  test('top edge, short document with no scroll range: fully visible, the shift is allowed', async () => {
    const { app, page } = await launch(FIXTURE_SHORT);
    try {
      expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
      await enterLayoutMode(page);
      const { dx, dy } = await overshoot(page, 'top', 60);
      await dragAndRelease(page, dx, dy);
      await expectFullyVisible(page);
    } finally {
      await app.close();
    }
  });

  test('left edge: fully visible, and still', async () => {
    const { app, page } = await launch();
    try {
      await enterLayoutMode(page);
      await placeDiagram(page, 250);
      const { dx, dy } = await overshoot(page, 'left', 160);
      const { before, after } = await dragAndRelease(page, dx, dy);
      expectStill(before, after);
      await expectFullyVisible(page);
    } finally {
      await app.close();
    }
  });

  test('right edge, in the centring container: fully visible, and still', async () => {
    const { app, page } = await launch();
    try {
      await enterLayoutMode(page);
      await placeDiagram(page, 250);
      const { dx, dy } = await overshoot(page, 'right', 120);
      const { before, after } = await dragAndRelease(page, dx, dy);
      expectStill(before, after);
      await expectFullyVisible(page);
    } finally {
      await app.close();
    }
  });

  test('corner: top and left together are fully visible, and still', async () => {
    const { app, page } = await launch();
    try {
      await enterLayoutMode(page);
      await placeDiagram(page, 250);
      const h = await overshoot(page, 'left', 100);
      const v = await overshoot(page, 'top', 60);
      const { before, after } = await dragAndRelease(page, h.dx, v.dy);
      expectStill(before, after);
      await expectFullyVisible(page);
    } finally {
      await app.close();
    }
  });

  test('a second growing drag still holds (the host offset composes with the renderer hold)', async () => {
    const { app, page } = await launch();
    try {
      await enterLayoutMode(page);
      await placeDiagram(page, 250);
      const svg = await page.locator(SVG).boundingBox();
      const node = await page.locator(HIT_AREAS).first().boundingBox();
      // Modest drags: a node dropped outside the container would end layout mode.
      const first = await dragAndRelease(page, -(node!.x - svg!.x) - 60, 0);
      expectStill(first.before, first.after);
      const second = await dragAndRelease(page, -50, 0);
      expectStill(second.before, second.after);
      await expectFullyVisible(page);
    } finally {
      await app.close();
    }
  });

  test('a drag inside the frame changes nothing: no scroll change, no offset', async () => {
    const { app, page } = await launch();
    try {
      await enterLayoutMode(page);
      await placeDiagram(page, 250);
      const scroll = () => page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
      const containerLeft = () => page.locator(CONTAINER).evaluate((el) => el.scrollLeft);
      const scrollBefore = await scroll();
      const leftBefore = await containerLeft();
      const { before, after } = await dragAndRelease(page, 12, 8);
      expectStill(before, after);
      expect(await scroll()).toEqual(scrollBefore);
      expect(await containerLeft()).toBe(leftBefore);
      expect(await page.locator(SVG).evaluate((el) => (el as SVGElement).style.translate)).toBe('');
    } finally {
      await app.close();
    }
  });
});
