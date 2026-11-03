import {
	AssistantRuntimeProvider,
	MessagePrimitive,
	ThreadPrimitive,
	useLocalRuntime,
	type ChatModelAdapter,
} from "@assistant-ui/react";
import { createElement, type ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { PluginEntry } from "@kilo-desktop/kernel";

import { renderInKernel } from "../../test/kernel-harness";
import { MarkdownExtension, type MarkdownExtensionImplementation } from "../../contracts";
import { ChatMarkdownProvider } from "./chat-markdown";
import { MarkdownText } from "./markdown-text";

const model: ChatModelAdapter = {
	async run() {
		return { content: [] };
	},
};

interface MarkdownAstNode {
	type: string;
	value?: string;
	url?: string;
	children?: MarkdownAstNode[];
}

function remarkTestBadge() {
	return (tree: MarkdownAstNode) => {
		const visit = (node: MarkdownAstNode) => {
			if (node.children) {
				node.children = node.children.flatMap((child) => {
					if (child.type !== "text" || child.value !== "[[badge]]") {
						visit(child);
						return [child];
					}
					return [
						{
							type: "link",
							url: "/extension/badge",
							children: [{ type: "text", value: "Plugin badge" }],
						},
					];
				});
			}
		};
		visit(tree);
	};
}

const testBadge: MarkdownExtensionImplementation = () => ({
	remarkPlugins: [remarkTestBadge],
	decorateComponents(next) {
		const NextAnchor = next.a ?? "a";
		return {
			...next,
			a({ href, children, ...props }: ComponentProps<"a">) {
				if (href === "/extension/badge") {
					return <button data-qa-id="test-markdown-extension">{children}</button>;
				}
				return createElement(NextAnchor, { href, ...props }, children);
			},
		};
	},
});

const badgePlugin = {
	manifest: {
		manifestVersion: 1,
		id: "acme.badge",
		displayName: "Acme badge",
		version: "1.0.0",
		requires: { "kilo.chat/markdown-extension": "optional" },
		contributes: { extensions: { "kilo.chat/markdown-extension": [{ id: "test-badge" }] } },
	},
	entry: {
		activate(sdk) {
			sdk.extensions.implement(MarkdownExtension, "test-badge", testBadge);
		},
	} satisfies PluginEntry,
};

function MarkdownMessage({
	text,
	partType,
}: {
	readonly text: string;
	readonly partType: "text" | "reasoning";
}) {
	const runtime = useLocalRuntime(model, {
		initialMessages: [{ role: "assistant", content: [{ type: partType, text }] }],
	});
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ChatMarkdownProvider
				sessionId="session-1"
				workspaceFolders={[{ path: "/workspace/project", isPrimary: true }]}
			>
				<ThreadPrimitive.Root>
					<ThreadPrimitive.Messages>
						{() => (
							<MessagePrimitive.Root>
								<MessagePrimitive.Parts
									components={{ Text: MarkdownText, Reasoning: MarkdownText }}
								/>
							</MessagePrimitive.Root>
						)}
					</ThreadPrimitive.Messages>
				</ThreadPrimitive.Root>
			</ChatMarkdownProvider>
		</AssistantRuntimeProvider>
	);
}

function renderMarkdownMessage(
	text: string,
	partType: "text" | "reasoning" = "text",
	rendererPlugins: readonly unknown[] = [],
) {
	return renderInKernel(<MarkdownMessage text={text} partType={partType} />, { rendererPlugins });
}

describe("MarkdownText", () => {
	it("composes a contributed remark plugin and component decorator", async () => {
		await renderMarkdownMessage("[[badge]]", "text", [badgePlugin]);

		await expect
			.element(page.getByTestId("test-markdown-extension"))
			.toHaveTextContent("Plugin badge");
	});

	it("renders a completed Mermaid fence as one diagram card", async () => {
		await renderMarkdownMessage("```mermaid\nflowchart LR\n  Start --> Done\n```");

		const card = page.getByTestId("chat-mermaid-card");
		await expect.element(card.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
		await expect.element(card.getByText("Flowchart", { exact: true })).toBeVisible();
		expect(document.querySelector(".aui-code-header-root")).toBeNull();
	});

	it("toggles a diagram card between diagram and source", async () => {
		await renderMarkdownMessage("```mermaid\nerDiagram\n  USER ||--o{ NOTEBOOK : owns\n```");
		await expect.element(page.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
		await expect.element(page.getByText("ER diagram", { exact: true })).toBeVisible();

		await page.getByRole("button", { name: "Show source" }).click();
		await expect.element(page.getByTestId("chat-mermaid-source")).toBeVisible();
		expect(document.querySelector('[data-qa-id="chat-mermaid-source"]')?.textContent).toContain(
			"erDiagram",
		);
		expect(document.querySelector('[data-qa-id="mermaid-diagram"]')).toBeNull();

		await page.getByRole("button", { name: "Show diagram" }).click();
		await expect.element(page.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
	});

	it.each([
		["without a trailing newline", "```mermaid\nflowchart LR\n  Start --> Done"],
		["with a trailing newline", "```mermaid\nflowchart LR\n  Start --> Done\n"],
	])("shows an unclosed streaming Mermaid fence %s as source", async (_label, text) => {
		await renderMarkdownMessage(text);

		await expect.element(page.getByTestId("chat-mermaid-source")).toBeVisible();
		expect(document.querySelector('[data-qa-id="chat-mermaid-source"]')?.textContent).toContain(
			"flowchart LR",
		);
		expect(document.querySelector('[data-qa-id="mermaid-diagram"]')).toBeNull();
		expect(document.querySelector(".aui-code-header-root")).toBeNull();
	});

	it("keeps a streaming fence as source when an earlier fence has the same body", async () => {
		const diagram = "flowchart LR\n  Start --> Done";
		await renderMarkdownMessage(
			`\`\`\`mermaid\n${diagram}\n\`\`\`\n\nAgain:\n\n\`\`\`mermaid\n${diagram}`,
		);

		await expect.element(page.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
		const cards = document.querySelectorAll('[data-qa-id="chat-mermaid-card"]');
		expect(cards).toHaveLength(2);
		expect(cards[0]?.querySelector('[data-qa-id="mermaid-diagram"]')).not.toBeNull();
		expect(cards[1]?.querySelector('[data-qa-id="mermaid-diagram"]')).toBeNull();
		expect(cards[1]?.querySelector('[data-qa-id="chat-mermaid-source"]')).not.toBeNull();
	});

	it.each([
		["a list item", "1. Step one\n\n   ```mermaid\n   flowchart LR\n     Start --> Done\n   ```"],
		["a blockquote", "> ```mermaid\n> flowchart LR\n>   Start --> Done\n> ```"],
		["a tilde fence", "~~~mermaid\nflowchart LR\n  Start --> Done\n~~~"],
		["a longer backtick fence", "````mermaid\nflowchart LR\n  Start --> Done\n````"],
		["an indented closing fence", "```mermaid\nflowchart LR\n  Start --> Done\n  ```"],
	])("renders a completed Mermaid fence in %s", async (_case, text) => {
		await renderMarkdownMessage(text);

		await expect
			.element(page.getByTestId("chat-mermaid-card").getByRole("img", { name: "Mermaid diagram" }))
			.toBeVisible();
	});

	it("does not overlay zoom controls on a diagram shrunk to fit the card", async () => {
		const chain = Array.from(
			{ length: 16 },
			(_, index) => `  N${String(index)}[Step number ${String(index)}] --> N${String(index + 1)}`,
		).join("\n");
		await renderMarkdownMessage(`\`\`\`mermaid\nflowchart LR\n${chain}\n\`\`\``);

		await expect
			.element(page.getByTestId("mermaid-diagram"), { timeout: 5_000 })
			.toHaveAttribute("aria-busy", "false");
		const svg = document.querySelector<SVGSVGElement>('[data-qa-id="mermaid-diagram"] svg');
		expect(svg?.getBoundingClientRect().width).toBeLessThan(Number(svg?.getAttribute("width")));
		expect(document.querySelector('[data-qa-id="mermaid-diagram"] .pele-zoom')).toBeNull();
	});

	it("renders a completed Mermaid fence in a reasoning part", async () => {
		await renderMarkdownMessage("```mermaid\nflowchart LR\n  Start --> Done\n```", "reasoning");

		await expect
			.element(page.getByTestId("chat-mermaid-card").getByRole("img", { name: "Mermaid diagram" }))
			.toBeVisible();
	});

	it("renders a completed fence whose code also starts an earlier diagram", async () => {
		await renderMarkdownMessage(
			"```mermaid\nflowchart LR\n  A --> B\n  B --> C\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```",
		);

		await expect
			.poll(() => document.querySelectorAll('[data-qa-id="mermaid-diagram"]').length)
			.toBe(2);
		expect(document.querySelector('[data-qa-id="chat-mermaid-source"]')).toBeNull();
	});
});
