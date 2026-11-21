import { useEffect, useId, useRef, useState } from "react";

import type { MarkdownMermaidDiagram } from "@kilo-desktop/ui/components/markdown-content";
import { useStableCallback } from "@kilo-desktop/ui/hooks/use-stable";

import { useLightboxRegistry } from "./lightbox/chat-lightbox";

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
export function mermaidDiagramLabel(code: string): string {
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

const DRAWN_DIAGRAMS = '[data-markdown="code-block"][data-code] > [data-markdown="mermaid"]';

interface Registration {
	readonly key: string;
	readonly code: string;
	readonly unregister: () => void;
}

/**
 * Puts the diagrams a reply's markdown draws into the transcript's viewer, so
 * Expand (or a click on a diagram) opens it there and ←/→ walks every diagram,
 * image and page of the transcript. Words renders diagrams as HTML, so they
 * are found in the rendered container and registered as they appear, change
 * or leave. Pass `attach` as the ref of an element around the markdown; outside a
 * transcript there is no viewer and `open` is undefined.
 */
export function useMermaidViewer() {
	const registry = useLightboxRegistry();
	const [container, setContainer] = useState<HTMLElement | null>(null);
	const registrations = useRef(new Map<HTMLElement, Registration>());
	const keyPrefix = useId();

	useEffect(() => {
		if (!registry || !container) return;
		const registered = registrations.current;
		let count = 0;
		const sync = () => {
			const present = new Set<HTMLElement>();
			for (const element of container.querySelectorAll<HTMLElement>(DRAWN_DIAGRAMS)) {
				present.add(element);
				const code = element.parentElement?.dataset.code ?? "";
				const existing = registered.get(element);
				if (existing?.code === code) continue;
				existing?.unregister();
				count += 1;
				const key = `${keyPrefix}-${String(count)}`;
				const item = { kind: "mermaid", id: key, code, label: mermaidDiagramLabel(code) } as const;
				registered.set(element, {
					key,
					code,
					unregister: registry.register(key, { item, element }),
				});
			}
			for (const [element, registration] of registered) {
				if (present.has(element)) continue;
				registration.unregister();
				registered.delete(element);
			}
		};
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(container, { childList: true, subtree: true });
		return () => {
			observer.disconnect();
			for (const registration of registered.values()) registration.unregister();
			registered.clear();
		};
	}, [registry, container, keyPrefix]);

	const open = useStableCallback(({ element }: MarkdownMermaidDiagram) => {
		const key = registrations.current.get(element)?.key;
		if (key) registry?.open(key);
	});
	return { attach: setContainer, open: registry ? open : undefined };
}
