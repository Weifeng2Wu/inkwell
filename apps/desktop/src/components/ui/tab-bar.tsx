"use client";

import {
  ArrowRightIcon,
  BookOpenTextIcon,
  CaretLineLeftIcon,
  CaretLineRightIcon,
  FileIcon,
  FilePdfIcon,
  FileTextIcon,
  FunctionIcon,
  type Icon,
  ImageIcon,
  MarkdownLogoIcon,
  PresentationChartIcon,
  TrashIcon,
  TreeStructureIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { useI18n } from "@/features/i18n";
import { fileDisplayName, visualDocumentKind } from "@/lib/file-types";

export interface TabItem {
  id: string;
  label: string;
  title?: string;
  badge?: string | number;
}

export type TabReorderPosition = "before" | "after";

type TabDropIndicator = {
  tabId: string;
  position: TabReorderPosition;
};

export type TabDragEndPayload = {
  tabId: string;
  clientX: number;
  clientY: number;
  dropTarget:
    | { type: "tab"; tabId: string; position: TabReorderPosition }
    | { type: "outside" }
    | { type: "none" };
};

export type TabDragMovePayload = {
  tabId: string;
  clientX: number;
  clientY: number;
};

export interface TabBarProps<T extends TabItem> {
  tabs: T[];
  activeTab: string;
  onTabSelect: (id: string) => void;
  onTabClose?: (id: string) => void;
  onTabReorder?: (draggedId: string, targetId: string, position: TabReorderPosition) => void;
  onTabDragMove?: (payload: TabDragMovePayload | null) => void;
  onTabDragEnd?: (payload: TabDragEndPayload) => void;
  onCloseOthers?: (id: string) => void;
  onCloseToLeft?: (id: string) => void;
  onCloseToRight?: (id: string) => void;
  onCloseAll?: () => void;
  className?: string;
}

type DragState = {
  isDragging: boolean;
  draggedTabId: string | null;
  draggedTabLabel: string | null;
  mouseX: number;
  mouseY: number;
  dropIndicator: TabDropIndicator | null;
};

const DRAG_THRESHOLD_PX = 6;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "eps"]);
const TEX_EXTENSIONS = new Set(["tex", "sty", "cls", "ltx"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown"]);

/** Splits a file name so the stem can be truncated while the extension stays visible. */
export function splitTabLabel(label: string): { stem: string; extension: string } {
  if (visualDocumentKind(label)) return { stem: fileDisplayName(label), extension: "" };
  const dot = label.lastIndexOf(".");
  if (dot <= 0 || dot === label.length - 1 || label.length - dot > 12) {
    return { stem: label, extension: "" };
  }
  return { stem: label.slice(0, dot), extension: label.slice(dot) };
}

/** The file-type icon for a tab, derived from its name. */
export function tabIcon(label: string): Icon {
  if (visualDocumentKind(label) === "mindmap") return TreeStructureIcon;
  if (visualDocumentKind(label) === "poster") return PresentationChartIcon;
  const extension = splitTabLabel(label).extension.slice(1).toLowerCase();
  if (TEX_EXTENSIONS.has(extension)) return FunctionIcon;
  if (extension === "bib") return BookOpenTextIcon;
  if (MARKDOWN_EXTENSIONS.has(extension)) return MarkdownLogoIcon;
  if (extension === "pdf") return FilePdfIcon;
  if (IMAGE_EXTENSIONS.has(extension)) return ImageIcon;
  return extension === "txt" ? FileTextIcon : FileIcon;
}

const initialDragState: DragState = {
  isDragging: false,
  draggedTabId: null,
  draggedTabLabel: null,
  mouseX: 0,
  mouseY: 0,
  dropIndicator: null,
};

export function TabBar<T extends TabItem>({
  tabs,
  activeTab,
  onTabSelect,
  onTabClose,
  onTabReorder,
  onTabDragMove,
  onTabDragEnd,
  onCloseOthers,
  onCloseToLeft,
  onCloseToRight,
  onCloseAll,
  className = "",
}: TabBarProps<T>) {
  const { t } = useI18n();
  const indicatorId = `tab-indicator-${useId()}`;
  const reducedMotion = useReducedMotion();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  const [dragState, setDragState] = useState<DragState>(initialDragState);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const draggedTabIdRef = useRef<string | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const dropIndicatorRef = useRef<TabDropIndicator | null>(null);
  const isDraggingRef = useRef(false);
  const suppressTabClickRef = useRef(false);
  const handleMouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const handleMouseUpRef = useRef<((e: MouseEvent) => void) | null>(null);

  const tabLabelById = useMemo(() => {
    const labelMap = new Map<string, string>();
    for (const tab of tabs) {
      labelMap.set(tab.id, tab.label);
    }
    return labelMap;
  }, [tabs]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      if (e.button === 1 && onTabClose) {
        e.preventDefault();
        onTabClose(tabId);
      }
    },
    [onTabClose],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      if (onTabClose) {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, tabId });
      }
    },
    [onTabClose],
  );

  const getContextMenuItems = useCallback(
    (tabId: string): ContextMenuItem[] => {
      const tabIndex = tabs.findIndex((tab) => tab.id === tabId);
      const items: ContextMenuItem[] = [];

      if (onTabClose) {
        items.push({
          label: t("editor.closeTab"),
          onClick: () => onTabClose(tabId),
          icon: <XIcon className="w-4 h-4" />,
        });
      }

      if (onCloseOthers) {
        items.push({
          label: t("editor.closeOtherTabs"),
          onClick: () => onCloseOthers(tabId),
          disabled: tabs.length <= 1,
          icon: <XCircleIcon className="w-4 h-4" />,
        });
      }

      if (onCloseToLeft) {
        items.push({
          label: t("editor.closeTabsToLeft"),
          onClick: () => onCloseToLeft(tabId),
          disabled: tabIndex === 0,
          icon: <CaretLineLeftIcon className="w-4 h-4" />,
        });
      }

      if (onCloseToRight) {
        items.push({
          label: t("editor.closeTabsToRight"),
          onClick: () => onCloseToRight(tabId),
          disabled: tabIndex === tabs.length - 1,
          icon: <CaretLineRightIcon className="w-4 h-4" />,
        });
      }

      if (onCloseAll) {
        items.push({
          label: t("editor.closeAllTabs"),
          onClick: onCloseAll,
          danger: true,
          icon: <TrashIcon className="w-4 h-4" />,
        });
      }

      return items;
    },
    [tabs, onTabClose, onCloseOthers, onCloseToLeft, onCloseToRight, onCloseAll, t],
  );

  const clearDocumentDragListeners = useCallback(() => {
    if (handleMouseMoveRef.current) {
      document.removeEventListener("mousemove", handleMouseMoveRef.current);
      handleMouseMoveRef.current = null;
    }
    if (handleMouseUpRef.current) {
      document.removeEventListener("mouseup", handleMouseUpRef.current);
      handleMouseUpRef.current = null;
    }
  }, []);

  const resetDragState = useCallback(() => {
    clearDocumentDragListeners();
    draggedTabIdRef.current = null;
    dragStartPosRef.current = null;
    dropIndicatorRef.current = null;
    isDraggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setDragState(initialDragState);
    onTabDragMove?.(null);
  }, [clearDocumentDragListeners, onTabDragMove]);

  useEffect(() => {
    return () => {
      resetDragState();
    };
  }, [resetDragState]);

  const setTabRef = useCallback((tabId: string, element: HTMLDivElement | null) => {
    if (element) {
      tabRefs.current.set(tabId, element);
      return;
    }
    tabRefs.current.delete(tabId);
  }, []);

  const isPointInsideContainer = useCallback((x: number, y: number): boolean => {
    const container = containerRef.current;
    if (!container) return false;
    const rect = container.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }, []);

  const findDropIndicator = useCallback(
    (pointerX: number, pointerY: number, draggedTabId: string): TabDropIndicator | null => {
      if (!isPointInsideContainer(pointerX, pointerY)) return null;

      const availableTabs = tabs.filter((tab) => tab.id !== draggedTabId);
      if (availableTabs.length === 0) return null;

      let candidate: TabDropIndicator | null = null;
      for (const tab of availableTabs) {
        const tabElement = tabRefs.current.get(tab.id);
        if (!tabElement) continue;
        const rect = tabElement.getBoundingClientRect();
        if (pointerX < rect.left + rect.width / 2) {
          return { tabId: tab.id, position: "before" };
        }
        candidate = { tabId: tab.id, position: "after" };
      }
      return candidate;
    },
    [tabs, isPointInsideContainer],
  );

  const handleDocumentMouseMove = useCallback(
    (e: MouseEvent) => {
      const draggedTabId = draggedTabIdRef.current;
      const dragStartPos = dragStartPosRef.current;
      if (!draggedTabId || !dragStartPos) return;

      if (!isDraggingRef.current) {
        const dx = e.clientX - dragStartPos.x;
        const dy = e.clientY - dragStartPos.y;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD_PX) return;
        isDraggingRef.current = true;
      }

      const indicator = findDropIndicator(e.clientX, e.clientY, draggedTabId);
      dropIndicatorRef.current = indicator;

      setDragState((prev) => ({
        ...prev,
        isDragging: true,
        mouseX: e.clientX,
        mouseY: e.clientY,
        dropIndicator: indicator,
      }));

      onTabDragMove?.({
        tabId: draggedTabId,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    },
    [findDropIndicator, onTabDragMove],
  );

  const handleDocumentMouseUp = useCallback(
    (e: MouseEvent) => {
      const draggedTabId = draggedTabIdRef.current;
      const dropIndicator = dropIndicatorRef.current;
      const wasDragging = isDraggingRef.current;

      let didReorder = false;
      if (
        wasDragging &&
        draggedTabId &&
        dropIndicator &&
        dropIndicator.tabId !== draggedTabId &&
        onTabReorder
      ) {
        onTabReorder(draggedTabId, dropIndicator.tabId, dropIndicator.position);
        didReorder = true;
      }

      if (wasDragging && draggedTabId) {
        const dropTarget: TabDragEndPayload["dropTarget"] =
          dropIndicator && dropIndicator.tabId !== draggedTabId
            ? {
                type: "tab",
                tabId: dropIndicator.tabId,
                position: dropIndicator.position,
              }
            : isPointInsideContainer(e.clientX, e.clientY)
              ? { type: "none" }
              : { type: "outside" };

        onTabDragEnd?.({
          tabId: draggedTabId,
          clientX: e.clientX,
          clientY: e.clientY,
          dropTarget,
        });

        if (didReorder || dropTarget.type === "none") {
          suppressTabClickRef.current = true;
          window.setTimeout(() => {
            suppressTabClickRef.current = false;
          }, 0);
        }
      }

      resetDragState();
    },
    [onTabReorder, onTabDragEnd, isPointInsideContainer, resetDragState],
  );

  const handleTabPointerDown = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      if (!onTabReorder) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-tab-close='true']")) return;

      resetDragState();
      e.preventDefault();

      draggedTabIdRef.current = tabId;
      dragStartPosRef.current = { x: e.clientX, y: e.clientY };
      isDraggingRef.current = false;
      dropIndicatorRef.current = null;
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";

      setDragState({
        isDragging: false,
        draggedTabId: tabId,
        draggedTabLabel: tabLabelById.get(tabId) ?? tabId,
        mouseX: e.clientX,
        mouseY: e.clientY,
        dropIndicator: null,
      });

      handleMouseMoveRef.current = handleDocumentMouseMove;
      handleMouseUpRef.current = handleDocumentMouseUp;
      document.addEventListener("mousemove", handleDocumentMouseMove);
      document.addEventListener("mouseup", handleDocumentMouseUp);
    },
    [onTabReorder, resetDragState, tabLabelById, handleDocumentMouseMove, handleDocumentMouseUp],
  );

  const handleTabClick = useCallback(
    (tabId: string) => {
      if (suppressTabClickRef.current) return;
      onTabSelect(tabId);
    },
    [onTabSelect],
  );

  // Keep the current tab in view when it is opened from elsewhere.
  useEffect(() => {
    tabRefs.current.get(activeTab)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeTab]);

  // A plain mouse wheel scrolls the strip sideways.
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaX === 0 && e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
  }, []);

  const dropTargetLabel = dragState.dropIndicator
    ? (tabLabelById.get(dragState.dropIndicator.tabId) ?? dragState.dropIndicator.tabId)
    : null;

  return (
    <>
      <div
        ref={containerRef}
        role="tablist"
        onWheel={handleWheel}
        className={`flex min-h-[34px] items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-border bg-surface-secondary ${className}`}
        style={{
          cursor: onTabReorder && dragState.isDragging ? "grabbing" : undefined,
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const isDragged = dragState.isDragging && dragState.draggedTabId === tab.id;
          const showDropBefore =
            dragState.dropIndicator?.tabId === tab.id &&
            dragState.dropIndicator.position === "before";
          const showDropAfter =
            dragState.dropIndicator?.tabId === tab.id &&
            dragState.dropIndicator.position === "after";
          const { stem, extension } = splitTabLabel(tab.label);
          const TypeIcon = tabIcon(tab.label);

          return (
            <div
              key={tab.id}
              ref={(node) => setTabRef(tab.id, node)}
              data-tab-id={tab.id}
              data-active={isActive}
              className={`group relative flex min-w-0 shrink-0 items-center border-r border-border transition-colors duration-100 select-none ${
                isActive
                  ? "bg-background text-foreground"
                  : "text-muted hover:bg-background/60 hover:text-foreground"
              } ${onTabReorder ? "cursor-grab" : ""} ${isDragged ? "opacity-40" : ""}`}
            >
              {showDropBefore && (
                <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-0.5 bg-accent z-10" />
              )}
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                title={tab.title ?? tab.label}
                onMouseDown={(e) => {
                  handleMouseDown(e, tab.id);
                  handleTabPointerDown(e, tab.id);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) e.preventDefault();
                }}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                onClick={() => handleTabClick(tab.id)}
                className={`flex h-full max-w-[200px] min-w-0 items-center gap-1.5 py-1.5 pl-3 text-[13px] ${
                  onTabClose ? "pr-1" : "pr-3"
                }`}
              >
                <TypeIcon aria-hidden className="size-3.5 shrink-0 text-muted" />
                <span className="flex min-w-0 items-baseline">
                  <span className="truncate">{stem}</span>
                  {extension && <span className="shrink-0">{extension}</span>}
                </span>
                {tab.badge !== undefined && (
                  <span className="shrink-0 text-[11px] text-muted">{tab.badge}</span>
                )}
              </button>
              {onTabClose && (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                  }}
                  data-tab-close="true"
                  className={`mr-1.5 flex size-5 shrink-0 items-center justify-center rounded text-muted transition-[opacity,background-color,color] duration-100 hover:bg-surface-tertiary hover:text-foreground focus-visible:opacity-100 ${
                    isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                  aria-label={t("editor.closeTabNamed", { name: tab.label })}
                >
                  <XIcon aria-hidden className="size-3" />
                </button>
              )}
              {isActive && (
                <motion.span
                  layoutId={indicatorId}
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 520, damping: 42 }
                  }
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-accent"
                />
              )}
              {showDropAfter && (
                <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-0.5 bg-accent z-10" />
              )}
            </div>
          );
        })}
      </div>

      {dragState.isDragging &&
        dragState.draggedTabLabel &&
        createPortal(
          <div
            className="motion-fade fixed pointer-events-none z-[9999] flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1 text-xs shadow-lg"
            style={{
              left: dragState.mouseX + 14,
              top: dragState.mouseY + 14,
            }}
          >
            <span className="truncate max-w-[220px]">{dragState.draggedTabLabel}</span>
            {dropTargetLabel && (
              <span className="flex items-center gap-1 whitespace-nowrap text-muted">
                <ArrowRightIcon aria-hidden className="size-3" />
                {dropTargetLabel}
              </span>
            )}
          </div>,
          document.body,
        )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={getContextMenuItems(contextMenu.tabId)}
        />
      )}
    </>
  );
}
