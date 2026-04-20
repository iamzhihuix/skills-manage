import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseFrontmatter } from "@/lib/frontmatter";
import { cn } from "@/lib/utils";

const markdownTypographyClass = cn(
  "text-[13px] leading-6 text-foreground/90",
  "[&_p]:text-[13px] [&_p]:leading-6",
  "[&_li]:text-[13px] [&_li]:leading-6",
  "[&_blockquote]:text-[13px] [&_blockquote]:leading-6",
  "[&_h1]:text-lg [&_h1]:leading-7 [&_h1]:font-semibold",
  "[&_h2]:text-base [&_h2]:leading-6 [&_h2]:font-semibold",
  "[&_h3]:text-sm [&_h3]:leading-6 [&_h3]:font-semibold",
  "[&_h4]:text-[13px] [&_h4]:leading-6 [&_h4]:font-semibold",
  "[&_th]:text-xs [&_th]:leading-5",
  "[&_td]:text-xs [&_td]:leading-5",
  "[&_code]:text-[12px]",
  "[&_pre]:text-[12px] [&_pre]:leading-5",
  "[&_pre_code]:text-[12px] [&_pre_code]:leading-5"
);

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  const { body } = parseFrontmatter(content);
  return (
    <div className={cn("markdown-body", markdownTypographyClass, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}
