import { describe, expect, it, vi } from 'vitest';

const initialize = vi.fn();
vi.mock('mermaid', () => ({
  default: { initialize, parse: vi.fn(), render: vi.fn() },
}));

describe('MermaidComponent mermaid configuration', () => {
  // Mermaid 12 changed the default layout (dagre -> ELK) and look
  // (classic -> neo). Without these two options, upgrading mermaid restyles
  // every diagram in a user's documents.
  it('pins the dagre layout and classic look', async () => {
    await import('./MermaidComponent');
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ layout: 'dagre', look: 'classic' }),
    );
  });
});
