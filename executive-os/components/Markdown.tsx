import { Fragment } from "react";

// Small renderer for the subset of markdown the assistant writes: headings, lists, bold, paragraphs.
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length} className="my-1 list-disc space-y-0.5 pl-5">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (item) { list.push(item[1]); continue; }
    flush();
    if (!line.trim()) continue;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(h
      ? <p key={blocks.length} className="mt-3 font-semibold first:mt-0">{inline(h[1])}</p>
      : <p key={blocks.length} className="my-1">{inline(line)}</p>);
  }
  flush();
  return <div className="text-sm leading-relaxed">{blocks}</div>;
}
