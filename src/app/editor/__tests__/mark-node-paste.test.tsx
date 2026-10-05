/**
 * Copying annotated text and pasting it inside the editor must not duplicate
 * the annotation's live `MarkNode`.
 *
 * Lexical 0.50 changed the in-editor clipboard payload
 * (`application/x-lexical-editor`) to ask `excludeFromCopy('clone')`, and
 * `MarkNode` answers "keep me" for `'clone'`. Without
 * `MarkNodePastePlugin`, a paste would carry a second `MarkNode` with the same annotation ids — a highlight
 * the host never placed, reported as a second rect for the same annotation.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $createMarkNode, $isMarkNode } from '@lexical/mark';
import { $dfs } from '@lexical/utils';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $setSelection,
  COPY_COMMAND,
  PASTE_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { editorNodes } from '../editorNodes';
import { MarkNodePastePlugin } from '../MarkNodePastePlugin';

afterEach(cleanup);

function Capture({ editorRef }: { editorRef: { current: LexicalEditor | null } }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);
  return null;
}

/** A ClipboardEvent whose clipboardData is a plain in-memory store. */
function clipboardEvent(type: 'copy' | 'paste', store: Map<string, string>): ClipboardEvent {
  const event = new ClipboardEvent(type, { bubbles: true, cancelable: true });
  const data = {
    setData: (format: string, value: string) => void store.set(format, value),
    getData: (format: string) => store.get(format) ?? '',
    get types() {
      return [...store.keys()];
    },
    files: [],
    items: [],
  };
  Object.defineProperty(event, 'clipboardData', { value: data });
  return event;
}

function markIds(editor: LexicalEditor): string[][] {
  return editor.getEditorState().read(() =>
    $dfs()
      .map(({ node }) => node)
      .filter($isMarkNode)
      .map((mark) => mark.getIDs()),
  );
}

async function copyAndPaste(selectWholeParagraph: boolean): Promise<LexicalEditor> {
  const editorRef: { current: LexicalEditor | null } = { current: null };
  render(
    <LexicalComposer
      initialConfig={{
        namespace: 'mark-node-paste-test',
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
      <MarkNodePastePlugin />
      <Capture editorRef={editorRef} />
    </LexicalComposer>,
  );
  const editor = editorRef.current!;

  await act(async () => {
    editor.update(
      () => {
        const mark = $createMarkNode(['a1']);
        mark.append($createTextNode('beta'));
        const p = $createParagraphNode().append(
          $createTextNode('alpha '),
          mark,
          $createTextNode(' gamma'),
        );
        $getRoot().clear().append(p, $createParagraphNode().append($createTextNode('end')));
        if (selectWholeParagraph) {
          p.select(0, p.getChildrenSize());
        } else {
          const text = mark.getFirstChildOrThrow();
          const selection = $createRangeSelection();
          selection.anchor.set(text.getKey(), 0, 'text');
          selection.focus.set(text.getKey(), 4, 'text');
          $setSelection(selection);
        }
      },
      { discrete: true },
    );
  });
  expect(markIds(editor)).toEqual([['a1']]);

  const store = new Map<string, string>();
  await act(async () => {
    editor.dispatchCommand(COPY_COMMAND, clipboardEvent('copy', store));
  });
  expect(store.has('application/x-lexical-editor')).toBe(true);

  await act(async () => {
    editor.update(
      () => {
        $getRoot().getLastChildOrThrow().selectEnd();
      },
      { discrete: true },
    );
    editor.dispatchCommand(PASTE_COMMAND, clipboardEvent('paste', store));
  });
  return editor;
}

describe('copy-paste of annotated text', () => {
  it('does not duplicate the mark when the marked text alone is copied', async () => {
    const editor = await copyAndPaste(false);
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toContain('endbeta');
    expect(markIds(editor)).toEqual([['a1']]);
  });

  it('does not duplicate the mark when it is nested in a copied paragraph', async () => {
    const editor = await copyAndPaste(true);
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toContain(
      'alpha beta gamma',
    );
    expect(
      editor.getEditorState().read(() => $getRoot().getTextContent().split('alpha beta gamma').length),
    ).toBe(3);
    expect(markIds(editor)).toEqual([['a1']]);
  });
});
