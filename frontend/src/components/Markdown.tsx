"use client";

import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
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

export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown text-[14px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}