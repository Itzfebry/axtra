"use client";

import "katex/dist/katex.min.css";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked; keep the action silent.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Tersalin" : "Salin kode"}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const element = (Array.isArray(children) ? children[0] : children) as
    | { props?: { className?: string; children?: ReactNode } }
    | undefined;
  const className = element?.props?.className ?? "";
  const raw = String(element?.props?.children ?? "").replace(/\n$/, "");
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? "code";

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5">
        <span className="text-xs text-muted">{language}</span>
        <CopyButton text={raw} />
      </div>
      <pre className="overflow-x-auto bg-surface-muted p-3">
        <code className="font-mono text-[13px] leading-relaxed">{raw}</code>
      </pre>
    </div>
  );
}

/**
 * Turn LaTeX delimiters the models commonly emit into the ones remark-math
 * understands: `\( ... \)` → inline `$ ... $`, `\[ ... \]` → display `$$ ... $$`.
 * Applied only outside fenced/inline code so real code is left untouched.
 */
function fixLatexTypos(segment: string): string {
  return segment
    .replace(/\\+fraq(?![a-zA-Z])/g, "\\frac")
    .replace(/\/(?:fraq|frac)(?![a-zA-Z])/g, "\\frac");
}

/**
 * Wrap bare LaTeX commands (e.g. `\frac{1}{2}` without `$`) in inline math so
 * they render instead of showing as raw text. Existing `$...$` is preserved.
 */
function wrapBareLatex(segment: string): string {
  return segment
    .split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/g)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/\\[a-zA-Z]+(?:\s*\{[^{}]*\})*/g, (match) => `$${match}$`),
    )
    .join("");
}

function normalizeMath(segment: string): string {
  return wrapBareLatex(
    fixLatexTypos(segment)
      .replace(
        /\\\[([\s\S]*?)\\\]/g,
        (_match, body: string) => `\n\n$$\n${body}\n$$\n\n`,
      )
      .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => `$${body}$`),
  );
}

/**
 * LLMs sometimes emit literal HTML line breaks (e.g. `<br>`) inside Markdown,
 * often within table cells. Renderers show them as raw text. Replace those
 * breaks with a visual separator, but leave fenced code blocks untouched.
 */
function normalizeMarkdown(content: string): string {
  const brPattern = /<br\s*\/?>/gi;
  return content
    .split(/(```[\s\S]*?```)/g)
    .map((segment) => {
      if (segment.startsWith("```")) {
        return segment;
      }
      // Leave inline code spans untouched too.
      return segment
        .split(/(`[^`]*`)/g)
        .map((part) =>
          part.startsWith("`")
            ? part
            : normalizeMath(part).replace(brPattern, " · "),
        )
        .join("");
    })
    .join("");
}

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

const components = {
  pre: ({ children }: { children?: ReactNode }) => (
    <CodeBlock>{children}</CodeBlock>
  ),
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown text-[14px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {normalizeMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Inline variant for short strings (quiz questions/options/explanations) that
 * should render math but not add block spacing. Paragraphs are unwrapped.
 */
export function MathText({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={{
        ...components,
        p: ({ children }: { children?: ReactNode }) => <>{children}</>,
      }}
    >
      {normalizeMarkdown(content)}
    </ReactMarkdown>
  );
}
