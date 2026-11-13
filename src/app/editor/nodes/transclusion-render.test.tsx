import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  resolveAndRenderTransclusion,
  renderTransclusionState,
  MAX_TRANSCLUSION_DEPTH,
  type TransclusionResolver,
} from './transclusion-render';

async function renderResult(
  file: string,
  blockId: string,
  resolver: TransclusionResolver | undefined,
  visitedPath: string[] = [],
): Promise<{ kind: string; html: string }> {
  const result = await resolveAndRenderTransclusion(file, blockId, resolver, visitedPath);
  return { kind: result.kind, html: renderToStaticMarkup(renderTransclusionState(result) as never) };
}

describe('resolveAndRenderTransclusion (#119)', () => {
  it('renders "unresolved" when no resolver is supplied (FR-008/SC-003)', async () => {
    const { kind, html } = await renderResult('notes.md', '01ABC', undefined);
    expect(kind).toBe('unresolved');
    expect(html).toContain('editor-transclusion-unresolved');
  });

  it('renders "unresolved" when the resolver returns null (FR-009)', async () => {
    const resolver: TransclusionResolver = vi.fn(async () => null);
    const { kind, html } = await renderResult('notes.md', '01ABC', resolver);
    expect(kind).toBe('unresolved');
    expect(html).toContain('editor-transclusion-unresolved');
    expect(resolver).toHaveBeenCalledWith('notes.md', '01ABC');
  });

  it('renders "unresolved" rather than throwing when the resolver rejects (FR-009)', async () => {
    const resolver: TransclusionResolver = vi.fn(async () => {
      throw new Error('boom');
    });
    const { kind } = await renderResult('notes.md', '01ABC', resolver);
    expect(kind).toBe('unresolved');
  });

  it('renders "unresolved" rather than throwing when the resolver returns a non-string value', async () => {
    // A resolver that violates its own Promise<string | null> contract (a
    // host bug, or a non-TS host) must still degrade safely instead of
    // reaching parseMarkdown with a non-string and throwing.
    const resolver = vi.fn(async () => 42) as unknown as TransclusionResolver;
    const { kind, html } = await renderResult('notes.md', '01ABC', resolver);
    expect(kind).toBe('unresolved');
    expect(html).toContain('editor-transclusion-unresolved');
  });

  it('renders resolved plain-text content', async () => {
    const resolver: TransclusionResolver = vi.fn(async () => 'Hello world');
    const { kind, html } = await renderResult('notes.md', '01ABC', resolver);
    expect(kind).toBe('resolved');
    expect(html).toContain('Hello world');
    expect(html).toContain('editor-transclusion-content');
  });

  it('renders a resolved checkbox action item with checked state', async () => {
    const resolver: TransclusionResolver = vi.fn(async () => '- [x] Draft the boundary doc');
    const { html } = await renderResult('notes.md', '01ABC', resolver);
    expect(html).toContain('Draft the boundary doc');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
  });

  it('renders inline formatting (bold/italic/code) inside resolved content', async () => {
    const resolver: TransclusionResolver = vi.fn(async () => '**bold** and *italic* and `code`');
    const { html } = await renderResult('notes.md', '01ABC', resolver);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
  });

  it('detects a direct self-reference cycle (FR-010/SC-004)', async () => {
    const resolver: TransclusionResolver = vi.fn(async (file, blockId) => `![[${file}#^${blockId}]]`);
    const { kind, html } = await renderResult('notes.md', '01ABC', resolver);
    expect(kind).toBe('resolved'); // top-level call resolves; the *nested* embed is what's circular
    expect(html).toContain('editor-transclusion-circular');
  });

  it('detects a longer A -> B -> C -> A cycle (FR-010/SC-004)', async () => {
    const chain: Record<string, string> = {
      'a.md#^A': '![[b.md#^B]]',
      'b.md#^B': '![[c.md#^C]]',
      'c.md#^C': '![[a.md#^A]]',
    };
    const resolver: TransclusionResolver = vi.fn(async (file, blockId) => chain[`${file}#^${blockId}`] ?? null);
    const { html } = await renderResult('a.md', 'A', resolver);
    expect(html).toContain('editor-transclusion-circular');
  });

  it('renders nested (non-circular) transclusion within the bound', async () => {
    const resolver: TransclusionResolver = vi.fn(async (file, blockId) => {
      if (file === 'a.md' && blockId === 'A') return 'top ![[b.md#^B]] end';
      if (file === 'b.md' && blockId === 'B') return 'nested content';
      return null;
    });
    const { html } = await renderResult('a.md', 'A', resolver);
    expect(html).toContain('top');
    expect(html).toContain('nested content');
    expect(html).toContain('end');
    expect(html).not.toContain('editor-transclusion-circular');
    expect(html).not.toContain('editor-transclusion-depth-exceeded');
  });

  it('degrades to "depth-exceeded" beyond the bounded recursion depth (FR-011/SC-004)', async () => {
    // A chain of MAX_TRANSCLUSION_DEPTH + 2 distinct blocks, each embedding the next.
    const length = MAX_TRANSCLUSION_DEPTH + 2;
    const resolver: TransclusionResolver = vi.fn(async (_file, blockId) => {
      const n = Number(blockId);
      if (n >= length) return 'leaf';
      return `![[chain.md#^${n + 1}]]`;
    });
    const { html } = await renderResult('chain.md', '0', resolver);
    expect(html).toContain('editor-transclusion-depth-exceeded');
  });

  it('does not falsely flag the same block transcluded from two unrelated sites', async () => {
    const resolver: TransclusionResolver = vi.fn(async (file, blockId) => {
      if (file === 'a.md' && blockId === 'A') return 'left ![[shared.md#^S]] right ![[shared.md#^S]] end';
      if (file === 'shared.md' && blockId === 'S') return 'shared content';
      return null;
    });
    const { html } = await renderResult('a.md', 'A', resolver);
    expect(html).not.toContain('editor-transclusion-circular');
    const occurrences = html.split('shared content').length - 1;
    expect(occurrences).toBe(2);
  });
});

describe('transclusion source badge (#192)', () => {
  const FILE = 'daily/2026-10-13-team-sync.md';
  const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

  async function html(
    resolver: TransclusionResolver | undefined,
    visitedPath: string[] = [],
    file = FILE,
  ): Promise<string> {
    const result = await resolveAndRenderTransclusion(file, ID, resolver, visitedPath);
    return renderToStaticMarkup(renderTransclusionState(result, { file, blockId: ID }) as never);
  }

  const badgeAttrs = (h: string): string[] => h.match(/<a [^>]*editor-transclusion-source[^>]*>/g) ?? [];

  it('renders a link-shaped badge in the resolved state', async () => {
    const h = await html(async () => 'Follow up on the rubric');
    const badges = badgeAttrs(h);
    expect(badges).toHaveLength(1);
    expect(badges[0]).toContain(`data-href="${FILE}"`);
    expect(badges[0]).toContain(`data-block-id="${ID}"`);
    expect(badges[0]).toContain('class="editor-link editor-transclusion-source"');
    expect(badges[0]).toContain('contentEditable="false"');
    expect(badges[0]).toContain('aria-label="Open source block"');
    expect(h).toContain('↗');
    expect(h).toContain('editor-transclusion-content');
  });

  it('does not carry data-wiki-link (WikiLinkExistencePlugin must ignore it)', async () => {
    expect(await html(async () => 'x')).not.toContain('data-wiki-link');
  });

  it('renders the badge in the unresolved, circular and depth-exceeded states', async () => {
    const unresolved = await html(undefined);
    expect(unresolved).toContain('editor-transclusion-unresolved');
    expect(badgeAttrs(unresolved)).toHaveLength(1);

    const circular = await html(async () => 'x', [`${FILE}#^${ID}`]);
    expect(circular).toContain('editor-transclusion-circular');
    expect(badgeAttrs(circular)[0]).toContain(`data-block-id="${ID}"`);

    const deep = await html(
      async () => 'x',
      Array.from({ length: MAX_TRANSCLUSION_DEPTH }, (_, i) => `f${i}.md#^k${i}`),
    );
    expect(deep).toContain('editor-transclusion-depth-exceeded');
    expect(badgeAttrs(deep)[0]).toContain(`data-href="${FILE}"`);
  });

  it('normalises an extensionless file like a [[file#^id]] link would', async () => {
    const h = await html(undefined, [], 'daily/standup');
    expect(badgeAttrs(h)[0]).toContain('data-href="daily/standup.md"');
  });

  it('keeps spaces in the path', async () => {
    const h = await html(undefined, [], 'my notes/Q3 plan.md');
    expect(badgeAttrs(h)[0]).toContain('data-href="my notes/Q3 plan.md"');
  });

  it('omits data-block-id when the reference has none', () => {
    const h = renderToStaticMarkup(
      renderTransclusionState({ kind: 'unresolved' }, { file: 'a.md' }) as never,
    );
    expect(badgeAttrs(h)[0]).toContain('data-href="a.md"');
    expect(badgeAttrs(h)[0]).not.toContain('data-block-id');
  });

  it('renders no badge and no wrapper for the one-argument call', () => {
    const h = renderToStaticMarkup(renderTransclusionState({ kind: 'unresolved' }) as never);
    expect(h).not.toContain('editor-transclusion-source');
    expect(h).not.toContain('editor-transclusion-wrap');
  });

  it('gives each nesting level a badge pointing at its own source', async () => {
    const resolver: TransclusionResolver = async (file) =>
      file === FILE ? 'outer ![[inner.md#^INNER1]]' : 'inner text';
    const h = await html(resolver);
    const badges = badgeAttrs(h);
    expect(badges).toHaveLength(2);
    expect(badges.some((b) => b.includes('data-href="inner.md"') && b.includes('data-block-id="INNER1"'))).toBe(true);
    expect(badges.some((b) => b.includes(`data-href="${FILE}"`) && b.includes(`data-block-id="${ID}"`))).toBe(true);
  });

  it('renders a nested wiki link as its own anchor, sibling of the badge', async () => {
    const h = await html(async () => 'see [[other-note]] and [[Plan|the plan]]');
    expect(h).toContain('<a class="editor-link" data-href="other-note.md">other-note</a>');
    expect(h).toContain('<a class="editor-link" data-href="Plan.md">the plan</a>');
    expect(h).not.toContain('data-wiki-link');
    // No anchor is nested inside another anchor.
    expect(/<a [^>]*>[^<]*<a /.test(h)).toBe(false);
  });

  it('carries the block id on a nested block-scoped wiki link', async () => {
    const h = await html(async () => 'see [[other.md#^BLK1]]');
    expect(h).toContain('data-href="other.md"');
    expect(h).toContain('data-block-id="BLK1"');
  });
});
