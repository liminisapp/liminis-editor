import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $isMarkNode } from '@lexical/mark';
import {
  $isElementNode,
  COMMAND_PRIORITY_CRITICAL,
  SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
  type LexicalNode,
} from 'lexical';

/**
 * Pasted content never carries annotation marks.
 *
 * A live `MarkNode` is placed by the annotation surface for an annotation the
 * host owns; it is not document content. Lexical 0.50 changed the in-editor
 * clipboard payload to ask `excludeFromCopy('clone')`, which `MarkNode`
 * answers by staying in the copy, so pasting annotated text produced a second
 * mark with the same annotation ids — a highlight nothing placed, and a second
 * rect reported for one annotation. Before 0.50 the mark was dropped on copy;
 * this restores that by unwrapping marks on the way in, whatever the source.
 *
 * Mounted unconditionally: `MarkNode` is always registered, whether or not
 * annotation kinds are configured.
 */
export function MarkNodePastePlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
        ({ nodes }) => {
          // In place: every later handler, and the default insertion, read
          // this same array.
          nodes.splice(0, nodes.length, ...$unwrapMarks(nodes));
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    [editor],
  );

  return null;
}

/** Replaces every `MarkNode` in `nodes`, at any depth, with its children. */
function $unwrapMarks(nodes: readonly LexicalNode[]): LexicalNode[] {
  const out: LexicalNode[] = [];
  for (const node of nodes) {
    if ($isMarkNode(node)) {
      const children = node.getChildren();
      for (const child of children) child.remove(true);
      out.push(...$unwrapMarks(children));
    } else {
      if ($isElementNode(node)) $unwrapNestedMarks(node);
      out.push(node);
    }
  }
  return out;
}

function $unwrapNestedMarks(element: import('lexical').ElementNode): void {
  for (const child of element.getChildren()) {
    if ($isMarkNode(child)) {
      for (const grandchild of child.getChildren()) child.insertBefore(grandchild);
      child.remove();
      // The moved children may themselves be (or contain) marks.
      $unwrapNestedMarks(element);
      return;
    }
    if ($isElementNode(child)) $unwrapNestedMarks(child);
  }
}
