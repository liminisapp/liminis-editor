/**
 * Coverage for LinkClickPlugin threading blockId through openLink (#119).
 *
 * FR-004: activating a block-scoped link must request navigation to that
 * specific file *and* block id when the host supports it. `blockId` is
 * additive on the OPEN_LINK payload, so a host that ignores it still opens
 * the file exactly as before.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { render, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $createParagraphNode, $createTextNode, type LexicalEditor } from 'lexical';
import { EditorHostProvider } from '../../host/context';
import type { EditorHostBridge, EditorHostServices } from '../../host/types';
import type { UIToHostMessage } from '../../types';
import { $createCustomLinkNode, $createTransclusionNode } from './nodes';
import { MAX_TRANSCLUSION_DEPTH } from './nodes/transclusion-render';
import { LinkClickPlugin } from './LinkClickPlugin';
import { editorNodes } from '../mapper/__tests__/roundtrip-test-utils';

function CaptureEditor({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    onReady(editor);
  }, [editor, onReady]);
  return null;
}

function stubBridge(): { bridge: EditorHostBridge; posted: UIToHostMessage[] } {
  const posted: UIToHostMessage[] = [];
  return {
    bridge: { postMessage: (message) => posted.push(message), addMessageHandler: () => () => {} },
    posted,
  };
}

async function mountPlugin(
  bridge: EditorHostBridge,
  plugin: ReactNode,
  services: Omit<EditorHostServices, 'bridge'> = {},
): Promise<{ editor: LexicalEditor; container: HTMLElement }> {
  let editor: LexicalEditor | null = null;
  let container!: HTMLElement;
  await act(async () => {
    ({ container } = render(
      <EditorHostProvider services={{ bridge, ...services }}>
        <LexicalComposer
          initialConfig={{
            namespace: 'link-click-plugin-test',
            nodes: editorNodes,
            onError: (e) => {
              throw e;
            },
          }}
        >
          <RichTextPlugin
            contentEditable={<ContentEditable />}
            placeholder={null}
            ErrorBoundary={({ children }) => <>{children}</>}
          />
          <CaptureEditor
            onReady={(e) => {
              editor = e;
            }}
          />
          {plugin}
        </LexicalComposer>
      </EditorHostProvider>,
    ));
  });
  return { editor: editor!, container };
}

afterEach(() => {
  cleanup();
});

describe('LinkClickPlugin blockId threading (#119)', () => {
  it('includes blockId in the OPEN_LINK payload for a block-scoped link, read-only mode', async () => {
    const { bridge, posted } = stubBridge();
    const { editor, container } = await mountPlugin(bridge, <LinkClickPlugin editable={false} />);

    await act(async () => {
      editor.update(() => {
        const paragraph = $createParagraphNode();
        const link = $createCustomLinkNode('notes.md');
        link.setBlockId('01ABC');
        link.append($createTextNode('notes.md'));
        paragraph.append(link);
        $getRoot().clear().append(paragraph);
      });
    });

    const anchor = container.querySelector('a[data-wiki-link="true"]')!;
    fireEvent.click(anchor);

    expect(posted).toEqual([{ type: 'OPEN_LINK', url: 'notes.md', blockId: '01ABC' }]);
  });

  it('omits blockId for an ordinary file-only link, read-only mode', async () => {
    const { bridge, posted } = stubBridge();
    const { editor, container } = await mountPlugin(bridge, <LinkClickPlugin editable={false} />);

    await act(async () => {
      editor.update(() => {
        const paragraph = $createParagraphNode();
        const link = $createCustomLinkNode('notes.md');
        link.append($createTextNode('notes.md'));
        paragraph.append(link);
        $getRoot().clear().append(paragraph);
      });
    });

    const anchor = container.querySelector('a[data-wiki-link="true"]')!;
    fireEvent.click(anchor);

    expect(posted).toEqual([{ type: 'OPEN_LINK', url: 'notes.md' }]);
    expect(posted[0]).not.toHaveProperty('blockId');
  });

  it('includes blockId on a modifier-click in editable mode too', async () => {
    const { bridge, posted } = stubBridge();
    const { editor, container } = await mountPlugin(bridge, <LinkClickPlugin editable />);

    await act(async () => {
      editor.update(() => {
        const paragraph = $createParagraphNode();
        const link = $createCustomLinkNode('notes.md');
        link.setBlockId('01ABC');
        link.append($createTextNode('notes.md'));
        paragraph.append(link);
        $getRoot().clear().append(paragraph);
      });
    });

    const anchor = container.querySelector('a[data-wiki-link="true"]')!;
    fireEvent.click(anchor, { metaKey: true });

    expect(posted).toEqual([{ type: 'OPEN_LINK', url: 'notes.md', blockId: '01ABC' }]);
  });
});

describe('transclusion source badge navigation (#192)', () => {
  const FILE = 'daily/2026-10-13-team-sync.md';
  const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

  async function mountTransclusion(
    editable: boolean,
    resolveTransclusion: EditorHostServices['resolveTransclusion'],
    file = FILE,
  ) {
    const { bridge, posted } = stubBridge();
    const mounted = await mountPlugin(bridge, <LinkClickPlugin editable={editable} />, { resolveTransclusion });
    await act(async () => {
      mounted.editor.update(() => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTransclusionNode(file, ID));
        $getRoot().clear().append(paragraph);
      });
    });
    await waitFor(() => {
      expect(mounted.container.querySelector('a.editor-transclusion-source')).not.toBeNull();
    });
    // Let the resolved state settle (the badge also renders while unresolved).
    return { ...mounted, posted };
  }

  const badge = (c: HTMLElement) => c.querySelector('a.editor-transclusion-source')!;

  it('read-only: a plain click on the badge posts exactly one OPEN_LINK with url and blockId', async () => {
    const { container, posted } = await mountTransclusion(false, async () => 'Follow up on the rubric');
    await waitFor(() => expect(container.textContent).toContain('Follow up on the rubric'));
    fireEvent.click(badge(container));
    expect(posted).toEqual([{ type: 'OPEN_LINK', url: FILE, blockId: ID }]);
  });

  it('editable: Cmd-click and Ctrl-click each post exactly one OPEN_LINK', async () => {
    const { container, posted } = await mountTransclusion(true, async () => 'Follow up on the rubric');
    await waitFor(() => expect(container.textContent).toContain('Follow up on the rubric'));
    fireEvent.click(badge(container), { metaKey: true });
    expect(posted).toEqual([{ type: 'OPEN_LINK', url: FILE, blockId: ID }]);
    fireEvent.click(badge(container), { ctrlKey: true });
    expect(posted).toHaveLength(2);
  });

  it('editable: a plain click does not navigate and is not default-prevented', async () => {
    const { container, posted } = await mountTransclusion(true, async () => 'Follow up on the rubric');
    await waitFor(() => expect(container.textContent).toContain('Follow up on the rubric'));
    const notPrevented = fireEvent.click(badge(container));
    expect(posted).toEqual([]);
    expect(notPrevented).toBe(true);
  });

  it('carries the modifier-held / links-clickable feedback classes on an ancestor of the badge', async () => {
    const readOnly = await mountTransclusion(false, async () => 'x');
    const root = readOnly.container.querySelector('[contenteditable], [data-lexical-editor]')!;
    expect(root.classList.contains('links-clickable')).toBe(true);
    expect(root.contains(badge(readOnly.container))).toBe(true);
    expect(badge(readOnly.container).classList.contains('editor-link')).toBe(true);
    cleanup();

    const editable = await mountTransclusion(true, async () => 'x');
    const editableRoot = editable.container.querySelector('[data-lexical-editor]')!;
    fireEvent.keyDown(window, { key: 'Meta', metaKey: true });
    expect(editableRoot.classList.contains('modifier-held')).toBe(true);
    expect(editableRoot.contains(badge(editable.container))).toBe(true);
  });

  it('a nested wiki link opens only its own target, not the transclusion source', async () => {
    const { container, posted } = await mountTransclusion(false, async () => 'see [[other-note]] today');
    await waitFor(() => expect(container.querySelector('.editor-transclusion-content a.editor-link')).not.toBeNull());
    fireEvent.click(container.querySelector('.editor-transclusion-content a.editor-link')!);
    expect(posted).toEqual([{ type: 'OPEN_LINK', url: 'other-note.md' }]);
  });

  it('a nested block-scoped wiki link carries its own blockId', async () => {
    const { container, posted } = await mountTransclusion(false, async () => 'see [[other.md#^BLK1]]');
    await waitFor(() => expect(container.querySelector('.editor-transclusion-content a.editor-link')).not.toBeNull());
    fireEvent.click(container.querySelector('.editor-transclusion-content a.editor-link')!);
    expect(posted).toEqual([{ type: 'OPEN_LINK', url: 'other.md', blockId: 'BLK1' }]);
  });

  it('navigates from the badge when the block is unresolved', async () => {
    const { container, posted } = await mountTransclusion(false, async () => null);
    await waitFor(() => expect(container.querySelector('.editor-transclusion-unresolved')).not.toBeNull());
    fireEvent.click(badge(container));
    expect(posted).toEqual([{ type: 'OPEN_LINK', url: FILE, blockId: ID }]);
  });

  it('navigates from the badge when the transclusion is circular', async () => {
    // The block transcludes itself.
    const { container, posted } = await mountTransclusion(false, async () => `![[${FILE}#^${ID}]]`);
    await waitFor(() => expect(container.querySelector('.editor-transclusion-circular')).not.toBeNull());
    // Outer badge is the last in document order (the nested one is inside the content).
    const badges = container.querySelectorAll('a.editor-transclusion-source');
    fireEvent.click(badges[badges.length - 1]);
    expect(posted).toEqual([{ type: 'OPEN_LINK', url: FILE, blockId: ID }]);
  });

  it('navigates from the badge when the transclusion is nested too deeply', async () => {
    // Each level transcludes the next, so the chain exceeds the bound.
    const resolver = async (file: string) => {
      const n = Number(/chain-(\d+)/.exec(file)?.[1] ?? '0');
      return `![[chain-${n + 1}.md#^K${n + 1}]]`;
    };
    const { container } = await mountTransclusion(false, resolver, 'chain-0.md');
    await waitFor(() => expect(container.querySelector('.editor-transclusion-depth-exceeded')).not.toBeNull());
    const deepest = container.querySelector('.editor-transclusion-depth-exceeded')!.parentElement!.querySelector(
      'a.editor-transclusion-source',
    )!;
    expect(deepest.getAttribute('data-href')).toBe(`chain-${MAX_TRANSCLUSION_DEPTH}.md`);
  });

  it('a nested transclusion\'s badge opens its own source', async () => {
    const resolver = async (file: string) => (file === FILE ? 'outer ![[inner.md#^INNER1]]' : 'inner text');
    const { container, posted } = await mountTransclusion(false, resolver);
    await waitFor(() => expect(container.textContent).toContain('inner text'));
    const inner = container.querySelector('a.editor-transclusion-source[data-block-id="INNER1"]')!;
    fireEvent.click(inner);
    expect(posted).toEqual([{ type: 'OPEN_LINK', url: 'inner.md', blockId: 'INNER1' }]);
  });

  it('emits a path with spaces as-is', async () => {
    const { container, posted } = await mountTransclusion(false, async () => 'x', 'my notes/Q3 plan.md');
    await waitFor(() => expect(container.textContent).toContain('x'));
    fireEvent.click(badge(container));
    expect(posted).toEqual([{ type: 'OPEN_LINK', url: 'my notes/Q3 plan.md', blockId: ID }]);
  });
});
