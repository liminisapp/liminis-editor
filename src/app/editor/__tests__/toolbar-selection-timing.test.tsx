/**
 * Lexical 0.52 moved `SELECTION_CHANGE_COMMAND` to run *before* DOM
 * reconciliation, inside the pending update, and made programmatic selection
 * changes notify without waiting for a native `selectionchange`. A handler
 * that reads `editor.getEditorState()` there sees the last *committed* state —
 * the previous selection — so the toolbar's format flags lag one selection
 * behind.
 *
 * Unlike `toolbar-annotation-create.test.tsx`, nothing here dispatches
 * `SELECTION_CHANGE_COMMAND` by hand after the update commits (that manual
 * dispatch runs outside any pending update and so cannot observe the timing).
 * The only notification is the one Lexical itself sends for the programmatic
 * selection change.
 *
 * This guards the deferral in `Toolbar`'s handler, not a behaviour 0.49 had:
 * 0.49 sent no notification for a programmatic selection at all (it waited for
 * a native `selectionchange`, which the test DOM never fires), so this test
 * fails there too. In a browser, Toolbar's own `selectionchange` listener
 * usually recomputes the flags afterwards anyway; without the deferral the
 * command handler is simply wrong, and this keeps it from becoming so again.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $createRangeSelection, $getRoot, $setSelection, type LexicalEditor } from 'lexical';
import { Toolbar } from '../Toolbar';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorState } from '../../mapper/mdastToLexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';

afterEach(cleanup);

const NEEDLE = 'bold words';

function Harness({ editorRef }: { editorRef: { current: LexicalEditor | null } }) {
  const [editor] = useLexicalComposerContext();
  editorRef.current = editor;
  useEffect(() => {
    editor.update(
      () => {
        importMarkdownToLexicalInEditorState(parseMarkdown(`plain **${NEEDLE}** plain\n`).root);
      },
      { discrete: true },
    );
  }, [editor]);
  return <Toolbar />;
}

/** Native selection first (Toolbar's visibility reads it), then Lexical's. */
function selectBold(editor: LexicalEditor): void {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent === NEEDLE) {
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, NEEDLE.length);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      break;
    }
  }
  if (!node) throw new Error(`no text node ${JSON.stringify(NEEDLE)}`);

  editor.update(
    () => {
      const text = $getRoot()
        .getAllTextNodes()
        .find((n) => n.getTextContent() === NEEDLE)!;
      const selection = $createRangeSelection();
      selection.anchor.set(text.getKey(), 0, 'text');
      selection.focus.set(text.getKey(), NEEDLE.length, 'text');
      selection.format = text.getFormat();
      $setSelection(selection);
    },
    { discrete: true },
  );
}

describe('Toolbar format flags under Lexical 0.52 selection timing', () => {
  it('reflect a programmatic selection without a manual SELECTION_CHANGE_COMMAND', async () => {
    const editorRef: { current: LexicalEditor | null } = { current: null };
    const { getByLabelText } = render(
      <LexicalComposer
        initialConfig={{
          namespace: 'toolbar-selection-timing-test',
          nodes: editorNodes,
          onError: (error: Error) => {
            throw error;
          },
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <Harness editorRef={editorRef} />
      </LexicalComposer>,
    );

    await act(async () => {
      selectBold(editorRef.current!);
    });

    expect(getByLabelText('Bold').className).toContain('active');
  });
});
