/**
 * Pure, host-resolver-driven resolution and rendering for block transclusion
 * (`![[file#^id]]`, #119). Split out from `TransclusionComponent.tsx` so the
 * cycle/depth guard and the mdast->JSX mini renderer are unit-testable
 * without mounting Lexical or React.
 *
 * Not a second `LexicalComposer`: transclusion is render-only (bidirectional
 * editing of transcluded content is explicitly out of scope), so resolved
 * block content is parsed once with the existing `parseMarkdown` and walked
 * into plain React elements by a small dedicated renderer here, rather than
 * mounting a second editable surface.
 */
import { createElement, Fragment, type ReactNode } from 'react';
import { parseMarkdown } from '../../../markdown/parse';
import { wikiTargetToUrl } from '../../../utils/file-types';

/** A host-injected resolver, matching `EditorHostServices.resolveTransclusion`. */
export type TransclusionResolver = (file: string, blockId: string) => Promise<string | null>;

/**
 * Nested transclusion depth bound (FR-011). A Plan-stage numeric choice, not
 * derived from anything structural — deep enough that legitimate nesting
 * (a summary block quoting a handful of sub-tasks, one level each) never
 * hits it, shallow enough that a missed-cycle edge case still terminates
 * fast. Checked *before* the resolver call at each level, so a document
 * that would exceed it never spends host I/O on content that gets discarded.
 */
export const MAX_TRANSCLUSION_DEPTH = 8;

export type TransclusionRenderState =
  | { kind: 'resolved'; content: ReactNode }
  | { kind: 'unresolved' }
  | { kind: 'circular' }
  | { kind: 'depth-exceeded' };

function blockKey(file: string, blockId: string): string {
  return `${file}#^${blockId}`;
}

/**
 * Resolve a `file#^blockId` reference to rendered content, guarding against
 * cycles and unbounded nesting.
 *
 * `visitedPath` is the chain of `file#^blockId` keys already open on *this*
 * branch of the resolution tree (ancestors, not a single global "already
 * transcluded anywhere" set) — the same block transcluded from two unrelated
 * sites in the same document must not falsely trip the cycle guard for the
 * second site.
 */
export async function resolveAndRenderTransclusion(
  file: string,
  blockId: string,
  resolver: TransclusionResolver | undefined,
  visitedPath: readonly string[] = [],
): Promise<TransclusionRenderState> {
  const key = blockKey(file, blockId);

  if (visitedPath.includes(key)) {
    return { kind: 'circular' };
  }
  if (visitedPath.length >= MAX_TRANSCLUSION_DEPTH) {
    return { kind: 'depth-exceeded' };
  }
  if (!resolver) {
    return { kind: 'unresolved' };
  }

  let raw: string | null;
  try {
    raw = await resolver(file, blockId);
  } catch {
    // FR-009: a resolver that throws is treated the same as one that
    // couldn't resolve — never let a host's rejected promise escape as an
    // unhandled error into the editor.
    raw = null;
  }
  if (raw === null || raw === undefined || typeof raw !== 'string') {
    // The `typeof` guard is load-bearing, not defensive padding: a resolver
    // that violates its own `Promise<string | null>` contract (returns a
    // number/object/etc.) must still degrade to "unresolved" rather than
    // reaching `parseMarkdown` with a non-string and throwing.
    return { kind: 'unresolved' };
  }

  try {
    const { root } = parseMarkdown(raw);
    const nextVisitedPath = [...visitedPath, key];
    const content = await renderNodes(root.children, resolver, nextVisitedPath);
    return { kind: 'resolved', content: createElement(Fragment, null, ...content) };
  } catch {
    // Never let a parse/render failure on resolved content escape as an
    // unhandled error into the editor — same "never throw" invariant as the
    // resolver-rejection guard above.
    return { kind: 'unresolved' };
  }
}

/** The source a transclusion points at, used to render its navigation badge. */
export interface TransclusionSourceRef {
  file: string;
  blockId?: string;
}

const SOURCE_BADGE_LABEL = 'Open source block';

/**
 * The trailing "↗" source badge (#192). Link-shaped exactly like a
 * `[[file#^id]]` link — `data-href` + `data-block-id` — so `LinkClickPlugin`
 * emits `openLink(url, blockId)` with no changes. It carries `editor-link` (so
 * the `modifier-held` / `links-clickable` cursor rules apply) but deliberately
 * NOT `data-wiki-link`, which `WikiLinkExistencePlugin` would pick up and style
 * as a possibly-broken link. `contenteditable=false` keeps the caret out of it.
 */
export function renderTransclusionSourceBadge(ref: TransclusionSourceRef): ReactNode {
  return createElement(
    'a',
    {
      className: 'editor-link editor-transclusion-source',
      'data-href': wikiTargetToUrl(ref.file),
      ...(ref.blockId ? { 'data-block-id': ref.blockId } : {}),
      contentEditable: false,
      suppressContentEditableWarning: true,
      title: SOURCE_BADGE_LABEL,
      'aria-label': SOURCE_BADGE_LABEL,
    },
    '↗',
  );
}

/** Render a {@link TransclusionRenderState} to a React node, for both the
 * top-level `TransclusionComponent` and a nested `wikiEmbed` inside
 * resolved content — the two share the same visual vocabulary. When `ref` is
 * given, a source badge navigating to it follows the state (#192); the badge
 * is a sibling of the content, never an ancestor of nested links. */
export function renderTransclusionState(
  state: TransclusionRenderState,
  ref?: TransclusionSourceRef,
): ReactNode {
  const body = renderTransclusionBody(state);
  if (!ref) return body;
  return createElement(
    'span',
    { className: 'editor-transclusion-wrap' },
    body,
    renderTransclusionSourceBadge(ref),
  );
}

function renderTransclusionBody(state: TransclusionRenderState): ReactNode {
  switch (state.kind) {
    case 'resolved':
      return createElement(
        'span',
        { className: 'editor-transclusion-content' },
        state.content,
      );
    case 'unresolved':
      return createElement(
        'span',
        { className: 'editor-transclusion-unresolved', title: 'This block could not be found.' },
        'Unresolved block reference',
      );
    case 'circular':
      return createElement(
        'span',
        { className: 'editor-transclusion-circular', title: 'This block transcludes itself.' },
        'Circular transclusion',
      );
    case 'depth-exceeded':
      return createElement(
        'span',
        { className: 'editor-transclusion-depth-exceeded', title: 'Transclusion nested too deeply.' },
        'Transclusion nested too deeply',
      );
  }
}

async function renderNodes(
  nodes: unknown[],
  resolver: TransclusionResolver | undefined,
  visitedPath: readonly string[],
): Promise<ReactNode[]> {
  const rendered = await Promise.all(nodes.map((node, index) => renderNode(node, resolver, visitedPath, index)));
  return rendered;
}

/**
 * Renders the subset of mdast node types the spec's own example (a checkbox
 * action item, plain prose, a nested transclusion) needs, plus common inline
 * formatting. Anything else falls back to plain extracted text — a
 * deliberate v1 scope limit (see the Plan's "lightweight renderer" risk
 * note), not a gap to silently paper over: this must never crash on
 * arbitrary block content (FR-015 lets *any* `^id`-carrying block be a
 * target, not just the checkbox shape the host emits today).
 */
async function renderNode(
  node: unknown,
  resolver: TransclusionResolver | undefined,
  visitedPath: readonly string[],
  key: number,
): Promise<ReactNode> {
  const n = node as { type?: string; [key: string]: unknown };
  if (!n || typeof n.type !== 'string') {
    return null;
  }

  switch (n.type) {
    case 'root':
    case 'paragraph': {
      const children = await renderNodes((n.children as unknown[]) ?? [], resolver, visitedPath);
      return createElement('span', { key, className: 'editor-transclusion-paragraph' }, ...children);
    }
    case 'text':
      return (n.value as string) ?? '';
    case 'strong': {
      const children = await renderNodes((n.children as unknown[]) ?? [], resolver, visitedPath);
      return createElement('strong', { key }, ...children);
    }
    case 'emphasis': {
      const children = await renderNodes((n.children as unknown[]) ?? [], resolver, visitedPath);
      return createElement('em', { key }, ...children);
    }
    case 'delete': {
      const children = await renderNodes((n.children as unknown[]) ?? [], resolver, visitedPath);
      return createElement('del', { key }, ...children);
    }
    case 'inlineCode':
      return createElement('code', { key }, (n.value as string) ?? '');
    case 'break':
      return createElement('br', { key });
    case 'heading': {
      const children = await renderNodes((n.children as unknown[]) ?? [], resolver, visitedPath);
      return createElement('strong', { key, className: 'editor-transclusion-heading' }, ...children);
    }
    case 'list': {
      const children = await renderNodes((n.children as unknown[]) ?? [], resolver, visitedPath);
      return createElement('span', { key, className: 'editor-transclusion-list' }, ...children);
    }
    case 'listItem': {
      const children = await renderNodes((n.children as unknown[]) ?? [], resolver, visitedPath);
      const checked = n.checked;
      if (checked === true || checked === false) {
        return createElement(
          'span',
          { key, className: 'editor-transclusion-list-item' },
          createElement('input', { type: 'checkbox', checked, readOnly: true, disabled: true }),
          ' ',
          ...children,
        );
      }
      return createElement('span', { key, className: 'editor-transclusion-list-item' }, '• ', ...children);
    }
    case 'wikiEmbed': {
      const target = (n.value as string) ?? '';
      const data = n.data as { blockId?: string } | undefined;
      const blockId = data?.blockId;
      if (!blockId) {
        // Never produced by parseMarkdown (FR-013 keeps a blockId-less node
        // typed `wikiLink`), but a hand-built mdast tree from a resolver
        // could still lack one — degrade to plain text rather than crash.
        return extractPlainText(n);
      }
      const nested = await resolveAndRenderTransclusion(target, blockId, resolver, visitedPath);
      return createElement('span', { key }, renderTransclusionState(nested, { file: target, blockId }));
    }
    case 'wikiLink': {
      // A link-only reference inside transcluded content (#192: now live —
      // ADR-192 amends ADR-119 §8). Same link shape as the badge, so the click
      // plugin's `closest('a')` finds this innermost anchor. No `data-wiki-link`:
      // the existence plugin only walks the editor's own DOM.
      const data = n.data as { alias?: string; blockId?: string } | undefined;
      const target = (n.value as string) ?? '';
      const label = data?.alias || target;
      if (!target) return label;
      return createElement(
        'a',
        {
          key,
          className: 'editor-link',
          'data-href': wikiTargetToUrl(target),
          ...(data?.blockId ? { 'data-block-id': data.blockId } : {}),
        },
        label,
      );
    }
    default:
      return extractPlainText(n);
  }
}

/** Generic fallback: recursively join every `.value` string found, so an
 * unrecognized node type still shows *something* rather than nothing. */
function extractPlainText(node: unknown): string {
  const n = node as { value?: unknown; children?: unknown[] } | null;
  if (!n) return '';
  if (typeof n.value === 'string') return n.value;
  if (Array.isArray(n.children)) return n.children.map(extractPlainText).join('');
  return '';
}
