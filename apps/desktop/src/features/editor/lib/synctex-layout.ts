export type SplitPaneSide = "left" | "right";

export type SplitPaneState = {
  side: SplitPaneSide;
  openTabs: string[];
  selectedFile?: string;
  content: string;
  isLoading: boolean;
  error: string | null;
  binaryPreviewUrl: string | null;
  pdfRefreshKey: number;
};

export function placeSynctexPdfOnRight(
  current: SplitPaneState | null,
  pdf: { path: string; url: string; refreshKey: number },
  sourcePath: string,
): SplitPaneState {
  const openTabs = (current?.openTabs ?? []).filter((path) => path !== sourcePath);
  return {
    side: "right",
    openTabs: openTabs.includes(pdf.path) ? openTabs : [...openTabs, pdf.path],
    selectedFile: pdf.path,
    content: "",
    isLoading: false,
    error: null,
    binaryPreviewUrl: pdf.url,
    pdfRefreshKey: pdf.refreshKey,
  };
}
