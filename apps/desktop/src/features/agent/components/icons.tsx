import {
  BookOpenTextIcon,
  CaretDownIcon,
  CaretRightIcon,
  FilePlusIcon,
  FolderOpenIcon,
  GlobeIcon,
  ListChecksIcon,
  NotePencilIcon,
  PaperPlaneRightIcon,
  CheckIcon as PhosphorCheckIcon,
  FolderIcon as PhosphorFolderIcon,
  ImageIcon as PhosphorImageIcon,
  PlusIcon as PhosphorPlusIcon,
  StopIcon as PhosphorStopIcon,
  TerminalIcon as PhosphorTerminalIcon,
  TrashIcon as PhosphorTrashIcon,
  WarningIcon as PhosphorWarningIcon,
  PlugIcon,
  QuestionIcon,
  RobotIcon,
  StarFourIcon,
  TextTIcon,
} from "@phosphor-icons/react";

export function ToolIcon({ tool }: { tool: string }) {
  const baseClassName = "size-4 flex-shrink-0";
  const toolLower = tool.toLowerCase();

  switch (toolLower) {
    // Terminal/Shell operations
    case "bash":
      return <PhosphorTerminalIcon className={`${baseClassName} text-success`} />;

    // File reading - eye/book icon in blue
    case "read":
      return <BookOpenTextIcon className={`${baseClassName} text-sky-500`} />;

    // File writing - file plus icon in green
    case "write":
      return <FilePlusIcon className={`${baseClassName} text-success`} />;

    // File editing - pencil icon in amber
    case "edit":
      return <NotePencilIcon className={`${baseClassName} text-warning`} />;

    // Search operations
    case "glob":
      return <FolderOpenIcon className={`${baseClassName} text-violet-500`} />;
    case "grep":
      return <TextTIcon className={`${baseClassName} text-violet-500`} />;

    // Web operations
    case "webfetch":
    case "websearch":
      return <GlobeIcon className={`${baseClassName} text-info`} />;

    // Agent/Task operations
    case "task":
      return <RobotIcon className={`${baseClassName} text-purple-500`} />;

    // Todo/Task list operations
    case "todowrite":
    case "todocreate":
    case "todoread":
    case "todolist":
    case "todoupdate":
      return <ListChecksIcon className={`${baseClassName} text-teal-500`} />;

    // MCP/Plugin operations
    case "mcp":
      return <PlugIcon className={`${baseClassName} text-accent-muted`} />;

    // Question/User input
    case "question":
    case "askuserquestion":
      return <QuestionIcon className={`${baseClassName} text-pink-500`} />;

    // List directory
    case "list":
      return <PhosphorFolderIcon className={`${baseClassName} text-accent`} />;

    default:
      return <StarFourIcon className={`${baseClassName} text-muted-foreground`} />;
  }
}

export function ChevronIcon({ className }: { className?: string }) {
  return <CaretDownIcon className={className} />;
}

export function ChevronRightIcon({ className }: { className?: string }) {
  return <CaretRightIcon className={className} />;
}

export function WarningIcon({ className }: { className?: string }) {
  return <PhosphorWarningIcon className={className} />;
}

export function TrashIcon({ className }: { className?: string }) {
  return <PhosphorTrashIcon className={className} />;
}

export function PlusIcon({ className }: { className?: string }) {
  return <PhosphorPlusIcon className={className} />;
}

export function CheckIcon({ className }: { className?: string }) {
  return <PhosphorCheckIcon className={className} weight="bold" />;
}

export function FolderIcon({ className }: { className?: string }) {
  return <PhosphorFolderIcon className={className} />;
}

export function TerminalIcon({ className }: { className?: string }) {
  return <PhosphorTerminalIcon className={className} />;
}

export function SendIcon({ className }: { className?: string }) {
  return <PaperPlaneRightIcon className={className} />;
}

export function ImageIcon({ className }: { className?: string }) {
  return <PhosphorImageIcon className={className} />;
}

export function StopIcon({ className }: { className?: string }) {
  return <PhosphorStopIcon className={className} />;
}

export function DisclosureTriangle({ open, className }: { open: boolean; className?: string }) {
  return (
    <CaretRightIcon
      className={`size-3 transition-transform ${open ? "rotate-90" : ""} ${className || ""}`}
      weight="fill"
    />
  );
}
