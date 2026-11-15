import {
  ArrowSquareOutIcon,
  CopyIcon,
  NotebookIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  QuotesIcon,
  SquareSplitHorizontalIcon,
  TagIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { ContextMenuItem } from "@/components/ui/context-menu";
import { pdfNotesPath } from "@/features/editor/lib/pdf-notes";
import {
  type LibraryItem,
  READING_STATUSES,
  type ReadingStatus,
  referenceLinks,
} from "../lib/library";

type Handlers = {
  t: (key: string, params?: Record<string, string | number>) => string;
  onCite: (item: LibraryItem) => void;
  onOpenBeside: (path: string) => void;
  onAttach: (item: LibraryItem) => void;
  onStatus: (item: LibraryItem, status: ReadingStatus) => void;
  onEditTags: (item: LibraryItem) => void;
  onEditEntry: (item: LibraryItem) => void;
  onRemove: (item: LibraryItem) => void;
};

/** Asks for PDFs with the system file dialog; resolves to their absolute paths. */
export async function choosePdfs(multiple: boolean): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ multiple, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  return selected ? [selected].flat() : [];
}

/** Everything that can be done with one reference, for its context menu. */
export function libraryMenuItems(item: LibraryItem, handlers: Handlers): ContextMenuItem[] {
  const { t } = handlers;
  const { file } = item;
  const link = referenceLinks(item)[0];
  return [
    {
      label: t("library.cite"),
      icon: <QuotesIcon size={16} />,
      onClick: () => handlers.onCite(item),
    },
    {
      label: t("library.copyKey"),
      icon: <CopyIcon size={16} />,
      onClick: () => void navigator.clipboard.writeText(item.key),
    },
    ...(file
      ? [
          {
            label: t("library.openBeside"),
            icon: <SquareSplitHorizontalIcon size={16} />,
            onClick: () => handlers.onOpenBeside(file),
          },
          {
            label: t("library.openNotes"),
            icon: <NotebookIcon size={16} />,
            onClick: () => handlers.onOpenBeside(pdfNotesPath(file)),
          },
        ]
      : [
          {
            label: t("library.attachPdf"),
            icon: <PaperclipIcon size={16} />,
            onClick: () => handlers.onAttach(item),
          },
        ]),
    ...READING_STATUSES.filter((value) => value !== item.status).map((value) => ({
      label: t("library.markAs", { status: t(`library.status.${value}`) }),
      onClick: () => handlers.onStatus(item, value),
    })),
    {
      label: t("library.editTags"),
      icon: <TagIcon size={16} />,
      onClick: () => handlers.onEditTags(item),
    },
    ...(link
      ? [
          {
            label: t("library.openLink"),
            icon: <ArrowSquareOutIcon size={16} />,
            onClick: () =>
              void import("@tauri-apps/plugin-shell").then(({ open }) => open(link.url)),
          },
        ]
      : []),
    {
      label: t("library.editBibtex"),
      icon: <PencilSimpleIcon size={16} />,
      onClick: () => handlers.onEditEntry(item),
    },
    {
      label: t("common.remove"),
      icon: <TrashIcon size={16} />,
      danger: true,
      onClick: () => handlers.onRemove(item),
    },
  ];
}
