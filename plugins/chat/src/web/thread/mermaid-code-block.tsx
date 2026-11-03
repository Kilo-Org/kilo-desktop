import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import { MermaidDiagram } from "@kilo-desktop/ui/components/mermaid-diagram";
import { CheckIcon, CodeXmlIcon, CopyIcon, EyeIcon } from "lucide-react";
import { useState } from "react";

import { TooltipIconButton } from "./tooltip-icon-button";
import { useCopyToClipboard } from "./use-copy-to-clipboard";
import { useShellCopyText } from "./use-shell-copy-text";

const DIAGRAM_LABELS: Readonly<Record<string, string>> = {
	flowchart: "Flowchart",
	graph: "Flowchart",
	sequenceDiagram: "Sequence diagram",
	classDiagram: "Class diagram",
	stateDiagram: "State diagram",
	"stateDiagram-v2": "State diagram",
	erDiagram: "ER diagram",
	journey: "User journey",
	gantt: "Gantt chart",
	pie: "Pie chart",
	quadrantChart: "Quadrant chart",
	requirementDiagram: "Requirement diagram",
	gitGraph: "Git graph",
	mindmap: "Mindmap",
	timeline: "Timeline",
	sankey: "Sankey diagram",
	"sankey-beta": "Sankey diagram",
	xychart: "XY chart",
	"xychart-beta": "XY chart",
	block: "Block diagram",
	"block-beta": "Block diagram",
	packet: "Packet diagram",
	"packet-beta": "Packet diagram",
	kanban: "Kanban board",
	architecture: "Architecture diagram",
	"architecture-beta": "Architecture diagram",
};

/** Names the diagram from its type keyword, skipping frontmatter and `%%` comments. */
function diagramLabel(code: string): string {
	let inFrontmatter = false;
	for (const rawLine of code.split("\n")) {
		const line = rawLine.trim();
		if (line === "---") {
			inFrontmatter = !inFrontmatter;
			continue;
		}
		if (inFrontmatter || !line || line.startsWith("%%")) continue;
		const keyword = line.split(/[\s:;{]/u, 1)[0] ?? "";
		if (keyword.startsWith("C4")) return "C4 diagram";
		return DIAGRAM_LABELS[keyword] ?? "Diagram";
	}
	return "Diagram";
}

/** The Mermaid card renders its own header, so the generic code header is suppressed. */
export function MermaidCodeHeader() {
	return null;
}

type CodeNode = NonNullable<SyntaxHighlighterProps["node"]>;

function nodeText(node: CodeNode | CodeNode["children"][number]): string {
	if (node.type === "text") return node.value;
	return "children" in node ? node.children.map(nodeText).join("") : "";
}

/**
 * Reads closure from this block's own parsed node, not the message text: the
 * rendered text is smoothed and lags the store, and an identical earlier fence
 * would match a text search. A closed fence spans one line more than its body
 * (the closing marker) and ends past column 1. An unclosed fence either spans
 * only its body, or ends at column 1 when the stream stopped after a newline.
 */
function isClosedFence(node: CodeNode | undefined): boolean {
	const position = node?.position;
	if (!node || !position) return true;
	const bodyLines = nodeText(node).split("\n").length - 1;
	return position.end.line - position.start.line === bodyLines + 1 && position.end.column > 1;
}

/**
 * One card per Mermaid fence: a typed header with Diagram/Source and Copy
 * actions over a single body. An unclosed fence is still streaming, so the
 * body shows source and Pele never parses a partial diagram.
 */
export function MermaidCodeBlock({ code, node }: SyntaxHighlighterProps) {
	const isComplete = isClosedFence(node);
	const [showSource, setShowSource] = useState(false);
	const copyText = useShellCopyText();
	const { isCopied, copyToClipboard } = useCopyToClipboard(copyText);
	const showDiagram = isComplete && !showSource;

	return (
		<div
			className="border-border-subtle mt-3 overflow-hidden rounded-xl border"
			data-qa-id="chat-mermaid-card"
		>
			<div className="border-border-subtle bg-muted/50 flex items-center justify-between border-b px-3.5 py-1.5 text-xs">
				<span className="text-muted-foreground font-medium">{diagramLabel(code)}</span>
				<div className="flex items-center gap-0.5">
					{isComplete ? (
						<TooltipIconButton
							data-qa-id="chat-mermaid-source-toggle"
							tooltip={showSource ? "Show diagram" : "Show source"}
							onClick={() => setShowSource((value) => !value)}
						>
							{showSource ? <EyeIcon /> : <CodeXmlIcon />}
						</TooltipIconButton>
					) : null}
					<TooltipIconButton
						data-qa-id="chat-mermaid-copy"
						tooltip="Copy"
						onClick={() => {
							if (!isCopied) copyToClipboard(code);
						}}
					>
						{isCopied ? (
							<CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
						) : (
							<CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
						)}
					</TooltipIconButton>
				</div>
			</div>
			{showDiagram ? (
				<MermaidDiagram className="p-3.5" code={code} />
			) : (
				<pre
					className="bg-muted/30 overflow-x-auto p-3.5 text-sm leading-relaxed"
					data-qa-id="chat-mermaid-source"
				>
					<code>{code}</code>
				</pre>
			)}
		</div>
	);
}
