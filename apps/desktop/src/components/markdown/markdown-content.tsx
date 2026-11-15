import Image from "next/image";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import "./markdown-document.css";
import {
  createContext,
  memo,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  isLocalDocumentLink,
  type MarkdownLinkKind,
  transformWikiLinks,
  wikiLinkTargetFromHref,
} from "@/lib/markdown-links";
import { rehypeChatHtml } from "./safe-html";

const CodeBlockContext = createContext(false);

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];
const htmlRehypePlugins = [rehypeChatHtml, rehypeKatex];
const documentHtmlRehypePlugins: NonNullable<import("react-markdown").Options["rehypePlugins"]> = [
  [rehypeChatHtml, { allowImages: true }],
  rehypeKatex,
];

function MarkdownCode({
  children,
  className,
  onFileClick,
}: {
  children?: ReactNode;
  className?: string;
  onFileClick?: (path: string) => void;
}) {
  const filePattern =
    /\.(tex|bib|cls|sty|txt|md|json|yaml|yml|py|js|ts|tsx|css|html|pdf|png|jpg)$/i;
  const isInline = !useContext(CodeBlockContext);
  const content = String(children).replace(/\n$/, "");

  if (isInline) {
    if (onFileClick && filePattern.test(content)) {
      return (
        <button
          type="button"
          onClick={() => onFileClick(content)}
          className="cursor-pointer rounded bg-surface-secondary px-1 py-0.5 font-mono text-[0.9em] font-medium text-foreground hover:underline"
        >
          {content}
        </button>
      );
    }
    return (
      <code className="rounded bg-surface-secondary px-1 py-0.5 font-mono text-[0.9em] font-medium text-foreground">
        {content}
      </code>
    );
  }

  return <code className={className}>{children}</code>;
}

export const MarkdownContent = memo(function MarkdownContent({
  text,
  onFileClick,
  onWikiLinkClick,
  variant = "chat",
  resolveImage,
  revealLine,
}: {
  text: string;
  variant?: "chat" | "document";
  resolveImage?: (source: string) => string | undefined;
  onFileClick?: (path: string) => void;
  onWikiLinkClick?: (target: string, kind?: MarkdownLinkKind) => void;
  revealLine?: number;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [htmlReady, setHtmlReady] = useState(false);
  const enableWikiLinks = variant === "document" && Boolean(onWikiLinkClick);
  const renderedText = useMemo(
    () => (enableWikiLinks ? transformWikiLinks(text) : text),
    [text, enableWikiLinks],
  );
  useEffect(() => setHtmlReady(true), []);
  useEffect(() => {
    if (!revealLine || variant !== "document" || !htmlReady || !renderedText.trim()) return;
    contentRef.current
      ?.querySelector(`[data-source-line="${revealLine}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [revealLine, variant, renderedText, htmlReady]);
  const components = useMemo<Components>(() => {
    return {
      pre({ children }) {
        return (
          <pre className="my-3 max-w-full overflow-x-auto rounded-lg border border-border bg-surface-secondary p-3 font-mono text-xs leading-relaxed whitespace-pre [overflow-wrap:normal]">
            <CodeBlockContext.Provider value={true}>{children}</CodeBlockContext.Provider>
          </pre>
        );
      },
      code(props) {
        return <MarkdownCode {...props} onFileClick={onFileClick} />;
      },
      p({ children }) {
        return <p className="my-1.5">{children}</p>;
      },
      ul({ children }) {
        return <ul className="list-disc pl-4 my-1.5 space-y-0.5">{children}</ul>;
      },
      ol({ children, start }) {
        return (
          <ol start={start} className="list-decimal pl-5 my-2 space-y-1">
            {children}
          </ol>
        );
      },
      li({ children }) {
        return <li className="pl-0.5 [&>p]:my-1">{children}</li>;
      },
      a({ href, children, title }) {
        const wikiTarget = wikiLinkTargetFromHref(href);
        const localNote = href && isLocalDocumentLink(href);
        if (variant === "document" && onWikiLinkClick && (wikiTarget || localNote)) {
          return (
            <button
              type="button"
              title={title ?? wikiTarget ?? href}
              onClick={() =>
                onWikiLinkClick(wikiTarget ?? href ?? "", wikiTarget ? "wiki" : "markdown")
              }
              className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
            >
              {children}
            </button>
          );
        }
        return (
          <a
            href={href}
            title={title}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
          >
            {children}
          </a>
        );
      },
      strong({ children }) {
        return <strong className="font-semibold">{children}</strong>;
      },
      h1({ children, node }) {
        return (
          <h1
            data-source-line={variant === "document" ? node?.position?.start.line : undefined}
            className={
              variant === "document"
                ? "mt-8 mb-4 text-3xl font-semibold tracking-tight"
                : "text-sm font-bold mt-3 mb-1"
            }
          >
            {children}
          </h1>
        );
      },
      h2({ children, node }) {
        return (
          <h2
            data-source-line={variant === "document" ? node?.position?.start.line : undefined}
            className={
              variant === "document"
                ? "mt-7 mb-3 border-b border-border pb-2 text-2xl font-semibold"
                : "text-sm font-bold mt-3 mb-1"
            }
          >
            {children}
          </h2>
        );
      },
      h3({ children, node }) {
        return (
          <h3
            data-source-line={variant === "document" ? node?.position?.start.line : undefined}
            className={
              variant === "document"
                ? "mt-6 mb-2 text-xl font-semibold"
                : "text-[13px] font-bold mt-2 mb-1"
            }
          >
            {children}
          </h3>
        );
      },
      h4({ children, node }) {
        return (
          <h4
            data-source-line={variant === "document" ? node?.position?.start.line : undefined}
            className="mt-3 mb-1 font-semibold"
          >
            {children}
          </h4>
        );
      },
      h5({ children, node }) {
        return (
          <h5
            data-source-line={variant === "document" ? node?.position?.start.line : undefined}
            className="mt-2 mb-1 font-semibold"
          >
            {children}
          </h5>
        );
      },
      h6({ children, node }) {
        return (
          <h6
            data-source-line={variant === "document" ? node?.position?.start.line : undefined}
            className="mt-2 mb-1 font-medium text-muted"
          >
            {children}
          </h6>
        );
      },
      hr() {
        return <hr className="my-4 border-border" />;
      },
      blockquote({ children }) {
        return (
          <blockquote className="my-3 border-l-2 border-accent/30 pl-3 text-muted">
            {children}
          </blockquote>
        );
      },
      table({ children }) {
        return (
          <div className="my-3 max-w-full overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-xs leading-relaxed">{children}</table>
          </div>
        );
      },
      thead({ children }) {
        return <thead className="bg-accent-hover">{children}</thead>;
      },
      th({ children, style, align }) {
        return (
          <th
            style={{ ...style, textAlign: align && align !== "char" ? align : style?.textAlign }}
            className="border-b border-border px-3 py-2 text-left font-semibold text-foreground-secondary"
          >
            {children}
          </th>
        );
      },
      td({ children, style, align }) {
        return (
          <td
            style={{ ...style, textAlign: align && align !== "char" ? align : style?.textAlign }}
            className="border-b border-border px-3 py-2 align-top"
          >
            {children}
          </td>
        );
      },
      details({ children }) {
        return (
          <details className="my-3 rounded-md border border-border px-3 py-2">{children}</details>
        );
      },
      summary({ children }) {
        return <summary className="cursor-pointer font-medium">{children}</summary>;
      },
      img({ alt, src }) {
        const source = typeof src === "string" ? src : undefined;
        const image = source && resolveImage?.(source);
        if (image)
          return (
            <Image
              src={image}
              alt={alt ?? ""}
              width={1200}
              height={800}
              unoptimized
              className="my-4 h-auto max-w-full rounded-lg"
            />
          );
        return (
          <span className="text-muted">
            [{alt || "Image"}]
            {source && (
              <>
                {" ("}
                <a
                  href={source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  {source}
                </a>
                {")"}
              </>
            )}
          </span>
        );
      },
    };
  }, [onFileClick, onWikiLinkClick, resolveImage, variant]);

  return (
    <div
      ref={contentRef}
      className={`min-w-0 ${variant === "document" ? "markdown-document font-reading [&_table]:text-sm" : "max-w-full text-[13px] leading-7"} break-words [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden`}
      style={variant === "document" ? undefined : { fontFamily: "var(--font-family-body)" }}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={
          htmlReady
            ? variant === "document"
              ? documentHtmlRehypePlugins
              : htmlRehypePlugins
            : rehypePlugins
        }
        components={components}
      >
        {renderedText}
      </ReactMarkdown>
    </div>
  );
});
