"use client";

import { FileTextIcon } from "@phosphor-icons/react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/features/i18n";

type MainFileSwitcherProps = {
  mainFile: string | null;
  texFiles: string[];
  disabled?: boolean;
  onSelect: (mainFile: string) => void;
};

export function MainFileSwitcher({
  mainFile,
  texFiles,
  disabled = false,
  onSelect,
}: MainFileSwitcherProps) {
  const { t } = useI18n();
  const selectedFile = mainFile && texFiles.includes(mainFile) ? mainFile : "";
  const hint =
    texFiles.length === 0
      ? t("latex.noTexFiles")
      : selectedFile
        ? t("latex.currentMainFile", { file: selectedFile })
        : t("latex.switchMainFile");

  return (
    <Select
      value={selectedFile}
      onValueChange={onSelect}
      disabled={disabled || texFiles.length === 0}
    >
      <Tooltip label={hint}>
        <SelectPrimitive.Trigger
          data-tour="main-file"
          aria-label={t("latex.switchMainFile")}
          aria-description={hint}
          className="toolbar-icon-button"
        >
          <FileTextIcon className="size-4" aria-hidden="true" />
        </SelectPrimitive.Trigger>
      </Tooltip>
      <SelectContent className="min-w-56 max-w-[min(32rem,calc(100vw-2rem))]">
        <SelectPrimitive.Group>
          <SelectPrimitive.Label className="section-label px-2 py-1.5">
            {t("latex.switchMainFile")}
          </SelectPrimitive.Label>
          {texFiles.map((file) => (
            <SelectItem key={file} value={file} className="break-all font-mono text-xs">
              {file}
            </SelectItem>
          ))}
        </SelectPrimitive.Group>
      </SelectContent>
    </Select>
  );
}
