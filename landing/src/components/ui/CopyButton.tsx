import { useState } from "react";
import { copyToClipboard } from "../../lib/clipboard";

interface Props {
  text: string;
  label?: string;
}

export default function CopyButton({ text, label }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center rounded-[var(--radius-md)] border border-silver-light bg-surface-alt px-2 py-0.5 font-mono text-sm text-navy-900 hover:bg-navy-50 transition-colors"
    >
      {copied ? "copied!" : label ?? text}
    </button>
  );
}
