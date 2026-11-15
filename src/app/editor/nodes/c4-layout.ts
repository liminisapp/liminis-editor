/**
 * Pure helpers for a C4 node's manual layout.
 *
 * Imported only by the lazy `C4Component`, never by `C4Node.tsx`, so that
 * `C4Node` stays free of static `@liminis/diagrams` imports (ADR-075/079).
 */

import { parseC4 } from '@liminis/diagrams/core';
import type { ManualLayout } from '@liminis/diagrams/core';

/** Position keys starting with this prefix are synthetic (e.g. `__legend__`), not element ids. */
const RESERVED_PREFIX = '__';

/**
 * Reconcile a manual layout with hand-edited source.
 *
 * Keeps positions whose id still exists in the parsed source (and reserved
 * `__` keys); drops the rest. Never drops anything on the strength of a failed
 * or partial parse. Returns the same object when nothing was dropped, and
 * `undefined` when no positions remain.
 */
export function mergeManualLayout(
  code: string,
  layout: ManualLayout | undefined,
): ManualLayout | undefined {
  if (!layout) return layout;

  const parsed = parseC4(code);
  if (!parsed.diagram || parsed.errors.length > 0) return layout;

  const ids = new Set(parsed.diagram.elements.map((e) => e.id));
  const kept: ManualLayout['positions'] = {};
  let dropped = false;
  for (const [id, position] of Object.entries(layout.positions)) {
    if (id.startsWith(RESERVED_PREFIX) || ids.has(id)) {
      kept[id] = position;
    } else {
      dropped = true;
    }
  }

  if (!dropped) return layout;
  return Object.keys(kept).length > 0 ? { ...layout, positions: kept } : undefined;
}
