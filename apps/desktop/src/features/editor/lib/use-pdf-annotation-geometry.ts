import { useEffect, useMemo, useState } from "react";
import type { PdfGeometry, PdfPaintAnnotation } from "./pdf-geometry";
import type { PdfAnnotation } from "./pdf-notes";

/** Render-only migration. Never writes notes, colors, comments or PDF bytes. */
export function usePdfAnnotationGeometry(
  annotations: PdfAnnotation[],
  fingerprint: string,
  geometry: PdfGeometry | null,
) {
  const [refined, setRefined] = useState<Map<PdfAnnotation, PdfPaintAnnotation>>(new Map());
  useEffect(() => {
    let disposed = false;
    if (!geometry || !fingerprint) {
      setRefined(new Map());
      return;
    }
    const matching = annotations.filter((item) => item.fingerprint === fingerprint);
    void Promise.all(
      matching.map(async (item) => {
        try {
          return [item, await geometry.refineAnnotation(item)] as const;
        } catch {
          return [item, item] as const;
        }
      }),
    ).then((entries) => {
      if (!disposed) setRefined(new Map(entries));
    });
    return () => {
      disposed = true;
    };
  }, [annotations, fingerprint, geometry]);
  return useMemo(
    () => annotations.map<PdfPaintAnnotation>((item) => refined.get(item) ?? item),
    [annotations, refined],
  );
}
