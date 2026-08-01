import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MarkdownPreview(props: { body: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.body}</ReactMarkdown>;
}
