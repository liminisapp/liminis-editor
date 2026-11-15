/**
 * Package-level e2e for #203 — the C4 node must not jump when a node is released
 * after a drag that grew the diagram's frame (docs/decisions/adr-203-*.md).
 *
 * `@liminis/diagrams` 0.2.0 holds the diagram's origin steady while a node is
 * dragged out, then drops that hold on release, so the origin jumps by the
 * growth — and, in this editor's centring container, by half the growth on the
 * right. The unit tests fake all geometry; only a real Chromium layout can prove
 * the dropped node stays within 1px, which is what this spec measures.
 */
import { _electron as electron, test, expect, type ElectronApplication, type Page, type Locator } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const FIXTURE = join(HERE, 'fixtures', 'c4-release-shift.md');

const EDITOR = '[aria-label="Markdown editor"]';
const CONTAINER = '.c4-diagram-container';
const SVG = `${CONTAINER} svg[data-diagram="c4"]`;
const HIT_AREAS = `${SVG} g.interactive-layer > *`;

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [APP_DIR, '--content-file', FIXTURE] });
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

function expectStill(before: { x: number; y: number }, after: { x: number; y: number }): void {
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
}

test.describe('C4 node — release shift after a frame-growing drag (#203)', () => {
  test('left edge: the dropped node stays put', async () => {
    const { app, page } = await launch();
    try {
      await enterLayoutMode(page);
      const svg = await page.locator(SVG).boundingBox();
      const node = await page.locator(HIT_AREAS).first().boundingBox();
      // Pull the node well past the diagram's left edge.
      const dx = -(node!.x - svg!.x) - 160;
      const { before, after } = await dragAndRelease(page, dx, 0);
      expectStill(before, after);
    } finally {
      await app.close();
    }
  });

  test('top edge: the dropped node stays put', async () => {
    const { app, page } = await launch();
    try {
      await enterLayoutMode(page);
      const svg = await page.locator(SVG).boundingBox();
      const node = await page.locator(HIT_AREAS).first().boundingBox();
      const dy = -(node!.y - svg!.y) - 60;
      const { before, after } = await dragAndRelease(page, 0, dy);
      expectStill(before, after);
    } finally {
      await app.close();
    }
  });

  test('right edge, in the centring container: the dropped node stays put', async () => {
    const { app, page } = await launch();
    try {
      await enterLayoutMode(page);
      const svg = await page.locator(SVG).boundingBox();
      const node = await page.locator(HIT_AREAS).first().boundingBox();
      const dx = svg!.x + svg!.width - node!.x + 120;
      const { before, after } = await dragAndRelease(page, dx, 0);
      expectStill(before, after);
    } finally {
      await app.close();
    }
  });

  test('a second growing drag still holds (the host offset composes with the renderer hold)', async () => {
    const { app, page } = await launch();
    try {
      await enterLayoutMode(page);
      const svg = await page.locator(SVG).boundingBox();
      const node = await page.locator(HIT_AREAS).first().boundingBox();
      // Modest drags: a node dropped outside the container would end layout mode.
      const first = await dragAndRelease(page, -(node!.x - svg!.x) - 60, 0);
      expectStill(first.before, first.after);
      const second = await dragAndRelease(page, -50, 0);
      expectStill(second.before, second.after);
    } finally {
      await app.close();
    }
  });

  test('a drag inside the frame changes nothing: no scroll change, no offset', async () => {
    const { app, page } = await launch();
    try {
      await enterLayoutMode(page);
      const scrollBefore = await page.locator(CONTAINER).evaluate((el) => el.scrollLeft);
      const { before, after } = await dragAndRelease(page, 12, 8);
      expectStill(before, after);
      const scrollAfter = await page.locator(CONTAINER).evaluate((el) => el.scrollLeft);
      expect(scrollAfter).toBe(scrollBefore);
      expect(await page.locator(SVG).evaluate((el) => (el as SVGElement).style.translate)).toBe('');
    } finally {
      await app.close();
    }
  });
});
