import { Component, type ErrorInfo, type ReactNode } from "react";
import { HelpMarkdown } from "@usfm-tools/help-markdown";
import { cn } from "@/lib/utils";

type BoundaryState = { failed: boolean };

class MarkdownBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* keep the plain-text fallback visible */
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function HelpMarkdownView({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const text = content.replace(/\r\n/g, "\n").trim();
  if (!text) return null;
  const plain = <p className="scripture-editor__help-body">{text}</p>;
  return (
    <MarkdownBoundary fallback={plain}>
      <HelpMarkdown content={text} className={cn("scripture-editor__help-md", className)} />
    </MarkdownBoundary>
  );
}
