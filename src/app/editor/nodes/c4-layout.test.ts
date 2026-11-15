import { describe, expect, it } from 'vitest';
import { mergeManualLayout } from './c4-layout';

const SOURCE = `@startuml
!include C4_Container.puml
Person(user, "User")
System_Boundary(sys, "System") {
  Container(web, "Web", "React")
  Container(api, "API", "Node")
}
Rel(user, web, "Uses")
@enduml`;

const pos = (x: number, y: number) => ({ x, y });

describe('mergeManualLayout', () => {
  it('returns undefined when there is no layout', () => {
    expect(mergeManualLayout(SOURCE, undefined)).toBeUndefined();
  });

  it('returns the same object when every id still exists', () => {
    const layout = { positions: { user: pos(1, 2), sys: pos(3, 4), web: pos(5, 6), api: pos(7, 8) } };
    expect(mergeManualLayout(SOURCE, layout)).toBe(layout);
  });

  it('keeps all positions when an element is added', () => {
    const layout = { positions: { user: pos(1, 2), web: pos(5, 6) } };
    const added = SOURCE.replace('@enduml', 'Person(admin, "Admin")\n@enduml');
    expect(mergeManualLayout(added, layout)).toBe(layout);
  });

  it('drops only the position of a removed element', () => {
    const layout = { positions: { user: pos(1, 2), web: pos(5, 6), api: pos(7, 8) } };
    const removed = SOURCE.replace('  Container(api, "API", "Node")\n', '');
    expect(mergeManualLayout(removed, layout)).toEqual({
      positions: { user: pos(1, 2), web: pos(5, 6) },
    });
  });

  it('drops the old id and leaves the new one unpositioned on rename', () => {
    const layout = { positions: { user: pos(1, 2), web: pos(5, 6) } };
    const renamed = SOURCE.replace(/\bweb\b/g, 'frontend');
    const merged = mergeManualLayout(renamed, layout);
    expect(merged).toEqual({ positions: { user: pos(1, 2) } });
    expect(merged?.positions).not.toHaveProperty('frontend');
  });

  it('preserves reserved __ keys', () => {
    const layout = { positions: { user: pos(1, 2), gone: pos(9, 9), __legend__: pos(0, 0) } };
    expect(mergeManualLayout(SOURCE, layout)).toEqual({
      positions: { user: pos(1, 2), __legend__: pos(0, 0) },
    });
  });

  it('keeps boundary ids and ids nested in boundaries', () => {
    const layout = { positions: { sys: pos(1, 1), web: pos(2, 2), api: pos(3, 3) } };
    expect(mergeManualLayout(SOURCE, layout)).toBe(layout);
  });

  it('does not drop anything when the source does not parse', () => {
    const layout = { positions: { user: pos(1, 2), web: pos(5, 6) } };
    expect(mergeManualLayout('this is not c4 {{{', layout)).toBe(layout);
  });

  it('treats an empty source as a successful parse with no elements', () => {
    expect(mergeManualLayout('', { positions: { user: pos(1, 2) } })).toBeUndefined();
  });

  it('returns undefined when every position is dropped', () => {
    const layout = { positions: { gone: pos(1, 2) } };
    expect(mergeManualLayout(SOURCE, layout)).toBeUndefined();
  });
});
