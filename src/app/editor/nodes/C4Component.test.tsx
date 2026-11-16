/**
 * C4Component structural editing (#194).
 *
 * Uses a real LexicalComposer, the real C4Node and history, and the real
 * `applyC4Edit`. Only the renderer is mocked: `C4InteractiveRenderer` captures
 * its props so a test can drive `onEdit` and record what each render received.
 */
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $getRoot, REDO_COMMAND, UNDO_COMMAND } from 'lexical';
import type { LexicalEditor } from 'lexical';
import type { C4Edit, ManualLayout } from '@liminis/diagrams/core';
import type { C4EditContext } from '@liminis/diagrams/react';
import { editorNodes } from '../editorNodes';
import { $createC4Node, $isC4Node } from './C4Node';

interface RendererProps {
  diagram: { elements: { id: string }[] };
  manualPositions: Record<string, { x: number; y: number }>;
  onEdit?: (edit: C4Edit, context: C4EditContext) => void;
}

const frames: RendererProps[] = [];

vi.mock('@liminis/diagrams/react', () => ({
  C4Renderer: () => <div data-testid="static-renderer" />,
  C4ErrorDisplay: () => <div data-testid="error" />,
  C4InteractiveRenderer: (props: RendererProps) => {
    frames.push(props);
    return <div data-testid="interactive-renderer" />;
  },
}));

const CODE = `Person(user, "User")
Container(web, "Web", "React")
Container(api, "API", "Node")`;

const pos = (x: number, y: number) => ({ x, y });
const LAYOUT: ManualLayout = { positions: { user: pos(10, 20), web: pos(30, 40), api: pos(50, 60) } };

let editor: LexicalEditor;

function Capture(): null {
  const [composerEditor] = useLexicalComposerContext();
  useEffect(() => {
    editor = composerEditor;
  }, [composerEditor]);
  return null;
}

async function mount(code = CODE, layout: ManualLayout | null = LAYOUT): Promise<void> {
  render(
    <LexicalComposer
      initialConfig={{
        namespace: 'c4-test',
        nodes: editorNodes,
        onError: (e) => {
          throw e;
        },
        editorState: () => {
          $getRoot().append($createC4Node(code, layout ?? undefined));
        },
      }}
    >
      <Capture />
      <HistoryPlugin delay={0} />
      <RichTextPlugin
        contentEditable={<ContentEditable />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
    </LexicalComposer>,
  );
  await screen.findByTestId('static-renderer');
  // Lexical history never makes an editor's first update undoable (it only
  // records it as the baseline). Spend that update on a no-op so the edits
  // under test each get an undo entry, as they would in a live document.
  await act(async () => {
    editor.update(() => {
      $getRoot().getFirstChild()?.markDirty();
    });
  });
}

function readNode(): { code: string; layout: ManualLayout | undefined } {
  return editor.getEditorState().read(() => {
    const node = $getRoot().getFirstChild();
    if (!$isC4Node(node)) throw new Error('no C4 node');
    return { code: node.getCode(), layout: node.getManualLayout() };
  });
}

async function enterLayoutMode(): Promise<RendererProps> {
  const container = document.querySelector('.c4-diagram-container')!;
  fireEvent.mouseEnter(container);
  fireEvent.click(await screen.findByLabelText('Edit layout'));
  await screen.findByTestId('interactive-renderer');
  return frames[frames.length - 1];
}

async function undo(): Promise<void> {
  await act(async () => {
    editor.dispatchCommand(UNDO_COMMAND, undefined);
  });
}

async function redo(): Promise<void> {
  await act(async () => {
    editor.dispatchCommand(REDO_COMMAND, undefined);
  });
}

/** Run an onEdit call and let Lexical commit the update. */
async function edit(
  onEdit: NonNullable<RendererProps['onEdit']>,
  e: C4Edit,
  context: C4EditContext,
): Promise<void> {
  await act(async () => {
    onEdit(e, context);
  });
}

/** Count editor updates that dirtied any leaf node (i.e. would be a history candidate). */
function watchDirtyUpdates(): { count: () => number; stop: () => void } {
  let n = 0;
  const stop = editor.registerUpdateListener(({ dirtyLeaves }) => {
    if (dirtyLeaves.size > 0) n += 1;
  });
  return { count: () => n, stop };
}

beforeEach(() => {
  frames.length = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('diagram edits (onEdit)', () => {
  const addAdmin: C4Edit = { kind: 'add-element', elementKind: 'person', label: 'Admin', alias: 'admin' };

  it('inserts exactly the returned line and stores context.positions as received', async () => {
    await mount();
    const { onEdit } = await enterLayoutMode();
    const positions = { ...LAYOUT.positions, admin: pos(70, 80) };

    await edit(onEdit!, addAdmin, { positions });

    const { code, layout } = readNode();
    const added = code.split('\n').filter((l) => !CODE.split('\n').includes(l));
    expect(added).toHaveLength(1);
    expect(added[0]).toContain('Person(admin, "Admin"');
    // Every original line is still present, in order.
    expect(code.split('\n').filter((l) => CODE.split('\n').includes(l))).toEqual(CODE.split('\n'));
    expect(layout).toEqual({ positions });
    expect(layout?.positions.user).toEqual(pos(10, 20));
  });

  it('stores the full reported map on the first edit of a node with no layout', async () => {
    await mount(CODE, null);
    const { onEdit } = await enterLayoutMode();
    const positions = { user: pos(1, 1), web: pos(2, 2), api: pos(3, 3), admin: pos(4, 4) };

    await edit(onEdit!, addAdmin, { positions });

    expect(readNode().layout).toEqual({ positions });
  });

  it('adds a relationship line and leaves positions as reported', async () => {
    await mount();
    const { onEdit } = await enterLayoutMode();
    const relEdit: C4Edit = { kind: 'add-relationship', sourceId: 'user', targetId: 'web', label: 'Uses' };

    await edit(onEdit!, relEdit, { positions: { ...LAYOUT.positions } });

    const { code, layout } = readNode();
    expect(code.split('\n')).toHaveLength(CODE.split('\n').length + 1);
    expect(code).toContain('Rel(user, web, "Uses"');
    expect(layout).toEqual(LAYOUT);
  });

  it('reverts code and layout in one undo, and restores both on redo', async () => {
    await mount();
    const { onEdit } = await enterLayoutMode();
    const positions = { ...LAYOUT.positions, admin: pos(70, 80) };
    await edit(onEdit!, addAdmin, { positions });
    const after = readNode();

    await undo();
    expect(readNode()).toEqual({ code: CODE, layout: LAYOUT });

    await redo();
    expect(readNode()).toEqual(after);
  });

  it('never renders the new positions against the old code', async () => {
    await mount();
    const { onEdit } = await enterLayoutMode();
    frames.length = 0;

    await edit(onEdit!, addAdmin, { positions: { ...LAYOUT.positions, admin: pos(70, 80) } });
    await undo();
    await redo();

    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      const ids = frame.diagram.elements.map((e) => e.id);
      for (const id of Object.keys(frame.manualPositions)) {
        expect(ids).toContain(id);
      }
    }
  });

  it('changes nothing, and adds no history entry, when applyC4Edit rejects', async () => {
    await mount();
    const { onEdit } = await enterLayoutMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const watch = watchDirtyUpdates();
    const bad: C4Edit = { kind: 'add-relationship', sourceId: 'user', targetId: 'missing', label: 'x' };

    await edit(onEdit!, bad, { positions: { ...LAYOUT.positions, ghost: pos(9, 9) } });

    expect(readNode()).toEqual({ code: CODE, layout: LAYOUT });
    expect(warn).toHaveBeenCalled();
    expect(watch.count()).toBe(0);
    watch.stop();
  });

  it('uses the node code, not a stale render, for consecutive edits', async () => {
    await mount();
    const { onEdit } = await enterLayoutMode();
    const second: C4Edit = { kind: 'add-element', elementKind: 'person', label: 'Ops', alias: 'ops' };

    await edit(onEdit!, addAdmin, { positions: { ...LAYOUT.positions, admin: pos(1, 1) } });
    await edit(onEdit!, second, { positions: { ...LAYOUT.positions, admin: pos(1, 1), ops: pos(2, 2) } });

    const { code } = readNode();
    expect(code).toContain('Person(admin, "Admin"');
    expect(code).toContain('Person(ops, "Ops"');
  });
});

describe('hand edits (merge on close)', () => {
  async function handEdit(next: string): Promise<void> {
    const container = document.querySelector('.c4-diagram-container')!;
    fireEvent.doubleClick(container);
    const textarea = await screen.findByPlaceholderText<HTMLTextAreaElement>('Enter C4 diagram code...');
    fireEvent.change(textarea, { target: { value: next } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    await screen.findByTestId('static-renderer');
  }

  it('keeps every position when an element is added by hand', async () => {
    await mount();
    await handEdit(`${CODE}\nPerson(admin, "Admin")`);
    expect(readNode().layout).toEqual(LAYOUT);
  });

  it('drops only the position of a hand-removed element', async () => {
    await mount();
    await handEdit(CODE.replace('Container(api, "API", "Node")', ''));
    expect(readNode().layout).toEqual({ positions: { user: pos(10, 20), web: pos(30, 40) } });
  });

  it('keeps positions when the edited source does not parse', async () => {
    await mount();
    await handEdit('Person(user, "User"');
    expect(readNode().layout).toEqual(LAYOUT);
  });

  it('creates no layout for a node without one', async () => {
    await mount(CODE, null);
    await handEdit(`${CODE}\nPerson(admin, "Admin")`);
    expect(readNode().layout).toBeUndefined();
  });

  it('restores code and layout together with one undo', async () => {
    await mount();
    await handEdit(CODE.replace('Container(api, "API", "Node")', ''));
    await undo();
    expect(readNode()).toEqual({ code: CODE, layout: LAYOUT });
  });

  it('creates no history entry when closing without a change', async () => {
    await mount();
    const container = document.querySelector('.c4-diagram-container')!;
    fireEvent.doubleClick(container);
    const textarea = await screen.findByPlaceholderText('Enter C4 diagram code...');
    const watch = watchDirtyUpdates();
    fireEvent.keyDown(textarea, { key: 'Escape' });
    await screen.findByTestId('static-renderer');
    await act(async () => {});

    expect(watch.count()).toBe(0);
    watch.stop();
    expect(readNode()).toEqual({ code: CODE, layout: LAYOUT });
  });
});
