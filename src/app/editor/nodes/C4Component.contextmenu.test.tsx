/**
 * One context menu in layout mode (#194).
 *
 * Uses the REAL `C4InteractiveRenderer` from `@liminis/diagrams` (no mock), so a
 * regression to two overlapping menus (the renderer's own `EditMenu` plus the
 * editor's `DiagramContextMenu`) is caught here rather than by hand.
 */
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $getRoot, UNDO_COMMAND } from 'lexical';
import type { LexicalEditor } from 'lexical';
import { editorNodes } from '../editorNodes';
import { $createC4Node, $isC4Node } from './C4Node';

const CODE = `Person(user, "User")
Container(web, "Web", "React")`;
const LAYOUT = { positions: { user: { x: 10, y: 20 }, web: { x: 200, y: 20 } } };

let editor: LexicalEditor;

function Capture(): null {
  const [e] = useLexicalComposerContext();
  useEffect(() => {
    editor = e;
  }, [e]);
  return null;
}

async function mountInLayoutMode(): Promise<HTMLElement> {
  render(
    <LexicalComposer
      initialConfig={{
        namespace: 'c4-menu-test',
        nodes: editorNodes,
        onError: (e) => {
          throw e;
        },
        editorState: () => {
          $getRoot().append($createC4Node(CODE, LAYOUT));
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
  const container = await waitForContainer();
  fireEvent.mouseEnter(container);
  fireEvent.click(await screen.findByLabelText('Edit layout'));
  await act(async () => {
    editor.update(() => {
      $getRoot().getFirstChild()?.markDirty();
    });
  });
  return container;
}

async function waitForContainer(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>('.c4-diagram-container');
    if (!el) throw new Error('C4 container not rendered');
    return el;
  });
}

/** Every menu in the document, whichever component drew it. */
const allMenus = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'));

const svg = (c: HTMLElement): SVGSVGElement => c.querySelector<SVGSVGElement>('svg:not(.lucide)')!;

// happy-dom has no SVG geometry. The renderer maps client points to diagram
// coordinates through getScreenCTM(), so give it an identity transform: client
// coordinates then ARE diagram coordinates (user sits at 10,20; web at 200,20).
beforeEach(() => {
  const identity = { inverse: () => identity };
  vi.spyOn(SVGSVGElement.prototype, 'getScreenCTM').mockReturnValue(identity as unknown as DOMMatrix);
  vi.spyOn(SVGSVGElement.prototype, 'createSVGPoint').mockImplementation(() => {
    const pt = { x: 0, y: 0, matrixTransform: () => ({ x: pt.x, y: pt.y }) };
    return pt as unknown as DOMPoint;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const EMPTY = { clientX: 900, clientY: 900 };
const ON_NODE = { clientX: 30, clientY: 30 };

describe('layout mode context menu', () => {
  it('opens exactly one menu on empty canvas, with the diagram items as their own groups', async () => {
    const container = await mountInLayoutMode();

    await act(async () => {
      fireEvent.contextMenu(svg(container), EMPTY);
    });

    expect(allMenus()).toHaveLength(1);
    expect(container.querySelector('[data-c4-menu]')).toBeNull(); // the renderer's own menu
    const menu = within(allMenus()[0]);
    // The editor's items are there...
    expect(menu.getByText('Exit layout mode')).toBeTruthy();
    expect(menu.getByText('Copy image to clipboard')).toBeTruthy();
    // ...and so are the diagram's, as separate groups: elements, then boundaries.
    const groups = menu.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['element', 'boundary']);
    expect(menu.getAllByRole('menuitem').some((i) => i.dataset.menuItemId === 'add:element:person')).toBe(true);
    expect(
      menu.getAllByRole('menuitem').some((i) => i.dataset.menuItemId === 'add:boundary:systemBoundary'),
    ).toBe(true);
  });

  it('opens one menu with the editor items only on a node', async () => {
    const container = await mountInLayoutMode();

    await act(async () => {
      fireEvent.contextMenu(svg(container), ON_NODE);
    });

    expect(allMenus()).toHaveLength(1);
    expect(container.querySelector('[data-c4-menu]')).toBeNull();
    const menu = within(allMenus()[0]);
    expect(menu.getByText('Exit layout mode')).toBeTruthy();
    expect(menu.queryAllByRole('group')).toHaveLength(0);
    expect(menu.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('never has the renderer menu and the editor menu open together, across repeated right-clicks', async () => {
    const container = await mountInLayoutMode();

    for (const at of [EMPTY, ON_NODE, { clientX: 920, clientY: 910 }]) {
      await act(async () => {
        fireEvent.contextMenu(svg(container), at);
      });
      expect(allMenus()).toHaveLength(1);
      expect(document.querySelectorAll('[data-c4-menu]')).toHaveLength(0);
    }
  });

  const readNode = (): { code: string; layout: unknown } =>
    editor.getEditorState().read(() => {
      const n = $getRoot().getFirstChild();
      if (!$isC4Node(n)) throw new Error('no C4 node');
      return { code: n.getCode(), layout: n.getManualLayout() };
    });

  const undo = async (): Promise<void> => {
    await act(async () => {
      editor.dispatchCommand(UNDO_COMMAND, undefined);
    });
  };

  it('picking an add item behaves as the diagram menu did: label prompt, onEdit, positions, one undo step', async () => {
    const container = await mountInLayoutMode();
    await act(async () => {
      fireEvent.contextMenu(svg(container), EMPTY);
    });

    await act(async () => {
      fireEvent.click(within(allMenus()[0]).getByText('Person'));
    });

    // Our menu is gone, and nothing is written until the label is confirmed.
    expect(allMenus()).toHaveLength(0);
    expect(readNode().code).toBe(CODE);
    const input = container.querySelector<HTMLInputElement>('[data-c4-label-input]');
    expect(input).not.toBeNull();

    await act(async () => {
      fireEvent.change(input!, { target: { value: 'Admin' } });
      fireEvent.keyDown(input!, { key: 'Enter' });
    });

    const after = readNode();
    expect(after.code.split('\n')).toHaveLength(CODE.split('\n').length + 1);
    expect(after.code).toContain('Person(admin, "Admin"');
    const positions = (after.layout as { positions: Record<string, { x: number; y: number }> }).positions;
    // Existing elements did not move; the new one was placed where the menu opened.
    expect(positions.user).toEqual(LAYOUT.positions.user);
    expect(positions.web).toEqual(LAYOUT.positions.web);
    expect(positions.admin).toBeDefined();
    expect(Math.abs(positions.admin.x - 900)).toBeLessThan(200);

    await undo();
    expect(readNode()).toEqual({ code: CODE, layout: LAYOUT });
  });

  it('a long-press opens the same single menu, with the diagram items', async () => {
    const container = await mountInLayoutMode();

    await act(async () => {
      fireEvent.pointerDown(svg(container), {
        pointerType: 'touch',
        pointerId: 7,
        isPrimary: true,
        button: 0,
        ...EMPTY,
      });
      await new Promise((r) => setTimeout(r, 600));
    });

    expect(allMenus()).toHaveLength(1);
    expect(document.querySelectorAll('[data-c4-menu]')).toHaveLength(0);
    const menu = within(allMenus()[0]);
    expect(menu.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['element', 'boundary']);
    expect(menu.getByText('Exit layout mode')).toBeTruthy();
  });

  it('closes the menu on Escape', async () => {
    const container = await mountInLayoutMode();
    await act(async () => {
      fireEvent.contextMenu(svg(container), EMPTY);
    });
    expect(allMenus()).toHaveLength(1);

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(allMenus()).toHaveLength(0);
  });
});

describe('outside layout mode', () => {
  it('shows the editor menu with no diagram items', async () => {
    render(
      <LexicalComposer
        initialConfig={{
          namespace: 'c4-menu-test-2',
          nodes: editorNodes,
          onError: (e) => {
            throw e;
          },
          editorState: () => {
            $getRoot().append($createC4Node(CODE, LAYOUT));
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
    const container = await waitForContainer();

    await act(async () => {
      fireEvent.contextMenu(container, { clientX: 5, clientY: 5 });
    });

    expect(allMenus()).toHaveLength(1);
    const menu = within(allMenus()[0]);
    expect(menu.getByText('Edit layout')).toBeTruthy();
    expect(menu.queryAllByRole('group')).toHaveLength(0);
    expect(menu.queryByText('Person')).toBeNull();
  });
});
