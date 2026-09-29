import type { ComponentType, ReactNode } from "react";

export type RemarkMarkdownRendererOptions = {
  allowDangerousHtml?: boolean;
  linkTarget?: "_blank" | "_self";
  headerBaseLevel?: number;
  onInternalLinkClick?: (
    href: string,
    linkType: "rc" | "relative" | "unknown",
    linkText?: string,
  ) => void;
  getEntryTitle?: (rcHref: string) => string | null;
};

export declare class RemarkMarkdownRenderer {
  constructor(options?: RemarkMarkdownRendererOptions);
  renderToReact(content: string): Promise<ReactNode>;
}

export type HelpMarkdownProps = {
  content: string;
  className?: string;
  onInternalLinkClick?: RemarkMarkdownRendererOptions["onInternalLinkClick"];
  getEntryTitle?: RemarkMarkdownRendererOptions["getEntryTitle"];
};

export const HelpMarkdown: ComponentType<HelpMarkdownProps>;

export function removeFirstHeading(content: string): string;
export function removeFirstHeadingAndDefinition(content: string): string;
