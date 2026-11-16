/* eslint-disable react-refresh/only-export-components */
/**
 * Shared context menu overlay for diagram nodes (C4, Mermaid).
 * Provides "Copy image to clipboard" and optional diagram-specific actions.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { copyDiagramToClipboard } from './diagram-context-menu';

/**
 * An extra action a diagram contributes to the menu (e.g. C4 "add element").
 * Items sharing a `group` are shown together; groups are separated from each
 * other and from the editor's own items.
 */
export interface DiagramMenuItem {
  id: string;
  label: string;
  group: string;
  onSelect: () => void;
}

export interface DiagramContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  containerRef: React.RefObject<HTMLElement | null> | null;
  items: DiagramMenuItem[];
}

export interface DiagramContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  onCopyImage: () => void;
  onClose: () => void;
  /** Optional: enter DSL text editor (double-click equivalent) */
  onEditText?: () => void;
  /** Optional: toggle drag layout mode */
  onEditLayout?: () => void;
  /** Optional: reset to auto layout */
  onResetLayout?: () => void;
  /** Whether drag layout mode is currently active */
  isEditingLayout?: boolean;
  /** Whether manual layout exists (show reset option) */
  hasManualLayout?: boolean;
  /**
   * Diagram-contributed items, shown above the editor's own items as one
   * group per `group` value. Absent or empty for diagrams that have none
   * (Mermaid), which leaves the menu unchanged.
   */
  items?: DiagramMenuItem[];
}

/**
 * Hook to manage diagram context menu state.
 */
export function useDiagramContextMenu() {
  const [state, setState] = useState<DiagramContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    containerRef: null,
    items: [],
  });

  const show = useCallback((e: React.MouseEvent, containerRef: React.RefObject<HTMLElement | null>) => {
    e.preventDefault();
    e.stopPropagation();
    setState({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      containerRef,
      items: [],
    });
  }, []);

  /**
   * Open the menu at a viewport point with diagram-contributed items. Used
   * when the diagram owns the contextmenu event and hands the host its items,
   * so there is still exactly one menu.
   */
  const showAt = useCallback((
    x: number,
    y: number,
    containerRef: React.RefObject<HTMLElement | null>,
    items: DiagramMenuItem[],
  ) => {
    setState({ visible: true, x, y, containerRef, items });
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleCopyImage = useCallback(async () => {
    if (state.containerRef?.current) {
      await copyDiagramToClipboard(state.containerRef.current);
    }
    close();
  }, [state.containerRef, close]);

  return {
    show,
    showAt,
    props: {
      visible: state.visible,
      x: state.x,
      y: state.y,
      items: state.items,
      onCopyImage: handleCopyImage,
      onClose: close,
    },
  };
}

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 10000,
  borderRadius: '6px',
  padding: '4px 0',
  minWidth: '180px',
};

const itemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px 12px',
  background: 'transparent',
  border: 'none',
  fontSize: '13px',
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

const separatorStyle: React.CSSProperties = {
  height: '1px',
  margin: '4px 8px',
};

/**
 * Context menu overlay component. Uses CSS variables for theming
 * with light/dark hex fallbacks for environments without VS Code vars.
 */
export function DiagramContextMenu({
  visible,
  x,
  y,
  onCopyImage,
  onClose,
  onEditText,
  onEditLayout,
  onResetLayout,
  isEditingLayout,
  hasManualLayout,
  items,
}: DiagramContextMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const bgColor = `var(--liminis-editor-menu-background)`;
  const borderColor = `var(--liminis-editor-menu-border)`;
  const textColor = `var(--liminis-editor-menu-foreground)`;
  const hoverBg = `var(--liminis-editor-menu-selectionBackground)`;
  const separatorColor = `var(--liminis-editor-menu-separatorBackground)`;

  // Close on click outside or Escape
  useEffect(() => {
    if (!visible) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  const handleHover = (e: React.MouseEvent, entering: boolean) => {
    (e.currentTarget as HTMLElement).style.background = entering ? hoverBg : 'transparent';
  };

  // Diagram items grouped in first-seen order (elements, then boundaries).
  const itemGroups: DiagramMenuItem[][] = [];
  for (const item of items ?? []) {
    const group = itemGroups.find((g) => g[0].group === item.group);
    if (group) group.push(item);
    else itemGroups.push([item]);
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      data-diagram-context-menu=""
      style={{
        ...menuStyle,
        left: x,
        top: y,
        background: bgColor,
        border: `1px solid ${borderColor}`,
        boxShadow: isDark ? '0 4px 12px rgba(0,0,0,0.3)' : '0 4px 12px rgba(0,0,0,0.12)',
      }}
    >
      {itemGroups.map((group) => (
        <div key={group[0].group} role="group" aria-label={group[0].group}>
          {group.map((item) => (
            <button
              key={item.id}
              role="menuitem"
              data-menu-item-id={item.id}
              onClick={() => { onClose(); item.onSelect(); }}
              style={{ ...itemStyle, color: textColor }}
              onMouseEnter={(e) => handleHover(e, true)}
              onMouseLeave={(e) => handleHover(e, false)}
            >
              {item.label}
            </button>
          ))}
          <div style={{ ...separatorStyle, background: separatorColor }} />
        </div>
      ))}
      {onEditText && (
        <button
          onClick={() => { onEditText(); onClose(); }}
          style={{ ...itemStyle, color: textColor }}
          onMouseEnter={(e) => handleHover(e, true)}
          onMouseLeave={(e) => handleHover(e, false)}
        >
          Edit text…
        </button>
      )}
      {onEditLayout && (
        <button
          onClick={() => { onEditLayout(); onClose(); }}
          style={{ ...itemStyle, color: textColor }}
          onMouseEnter={(e) => handleHover(e, true)}
          onMouseLeave={(e) => handleHover(e, false)}
        >
          {isEditingLayout ? 'Exit layout mode' : 'Edit layout'}
        </button>
      )}
      {onResetLayout && hasManualLayout && (
        <button
          onClick={() => { onResetLayout(); onClose(); }}
          style={{ ...itemStyle, color: textColor }}
          onMouseEnter={(e) => handleHover(e, true)}
          onMouseLeave={(e) => handleHover(e, false)}
        >
          Reset to auto layout
        </button>
      )}
      {(onEditText || onEditLayout) && (
        <div style={{ ...separatorStyle, background: separatorColor }} />
      )}
      <button
        onClick={onCopyImage}
        style={{ ...itemStyle, color: textColor }}
        onMouseEnter={(e) => handleHover(e, true)}
        onMouseLeave={(e) => handleHover(e, false)}
      >
        Copy image to clipboard
      </button>
    </div>
  );
}
