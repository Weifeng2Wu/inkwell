import type { ReactNode } from "react";

type Props = {
  /** A decorative icon, usually a Phosphor icon with `size-7`. */
  icon: ReactNode;
  /** What belongs in the panel, as a short statement. */
  title: string;
  /** One or two sentences on how to fill the panel. */
  description?: string;
  /** Actions and shortcut hints, shown below the description. */
  children?: ReactNode;
};

/** A sidebar panel with nothing to show: says what belongs there and how to fill it. */
export function PanelEmpty({ icon, title, description, children }: Props) {
  return (
    <div className="motion-rise flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-5 py-8 text-center">
      <span aria-hidden="true" className="mb-1 text-muted-foreground">
        {icon}
      </span>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-[16rem] text-xs leading-relaxed text-muted">{description}</p>
      )}
      {children}
    </div>
  );
}
