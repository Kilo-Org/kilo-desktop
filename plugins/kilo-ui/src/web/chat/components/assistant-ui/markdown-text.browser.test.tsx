import {
	AssistantRuntimeProvider,
	MessagePrimitive,
	ThreadPrimitive,
	useLocalRuntime,
	type ChatModelAdapter,
} from "@assistant-ui/react";
import { cleanup, render } from "@testing-library/react";
import { createElement, type ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { ChatMarkdownProvider } from "../../ChatMarkdownContext.js";
import type {
	ChatMarkdownExtension,
	ChatMarkdownExtensionContext,
} from "../../chat-markdown-extensions.js";
import { MarkdownText } from "./markdown-text.js";

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

function TestMarkdownExtension(_context: ChatMarkdownExtensionContext): ChatMarkdownExtension {
	return {
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
	};
}

function MarkdownMessage({
	text = "[[badge]]",
	partType = "text",
}: {
	readonly text?: string;
	readonly partType?: "text" | "reasoning";
}) {
	const runtime = useLocalRuntime(model, {
		initialMessages: [
			{
				role: "assistant",
				content: [{ type: partType, text }],
			},
		],
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

afterEach(cleanup);

describe("MarkdownText", () => {
	it("composes a contributed remark plugin and component decorator", async () => {
		const kiloSdk = createFakeSdk({ featureId: "kilo-ui" });
		const system = createFakeFeatureSystem({ sdks: { "kilo-ui": kiloSdk } });
		system.getSdk("test-plugin").contribute("kilo-ui/chat-markdown-extension", {
			id: "test-badge",
			component: TestMarkdownExtension,
			label: "Test badge",
			priority: 10,
		});

		render(
			<SdkProvider system={system}>
				<MarkdownMessage />
			</SdkProvider>,
		);

		await expect
			.element(page.getByTestId("test-markdown-extension"))
			.toHaveTextContent("Plugin badge");
	});

	it("renders a completed Mermaid fence as one diagram card", async () => {
		renderMarkdownMessage("```mermaid\nflowchart LR\n  Start --> Done\n```");

		const card = page.getByTestId("chat-mermaid-card");
		await expect.element(card.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
		await expect.element(card.getByText("Flowchart", { exact: true })).toBeVisible();
		expect(document.querySelector(".aui-code-header-root")).toBeNull();
	});

	it("toggles a diagram card between diagram and source", async () => {
		renderMarkdownMessage("```mermaid\nerDiagram\n  USER ||--o{ NOTEBOOK : owns\n```");
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
		renderMarkdownMessage(text);

		await expect.element(page.getByTestId("chat-mermaid-source")).toBeVisible();
		expect(document.querySelector('[data-qa-id="chat-mermaid-source"]')?.textContent).toContain(
			"flowchart LR",
		);
		expect(document.querySelector('[data-qa-id="mermaid-diagram"]')).toBeNull();
		expect(document.querySelector(".aui-code-header-root")).toBeNull();
	});

	it("keeps a streaming fence as source when an earlier fence has the same body", async () => {
		const diagram = "flowchart LR\n  Start --> Done";
		renderMarkdownMessage(
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
		renderMarkdownMessage(text);

		await expect
			.element(page.getByTestId("chat-mermaid-card").getByRole("img", { name: "Mermaid diagram" }))
			.toBeVisible();
	});

	it("does not overlay zoom controls on a diagram shrunk to fit the card", async () => {
		const chain = Array.from(
			{ length: 16 },
			(_, index) => `  N${String(index)}[Step number ${String(index)}] --> N${String(index + 1)}`,
		).join("\n");
		renderMarkdownMessage(`\`\`\`mermaid\nflowchart LR\n${chain}\n\`\`\``);

		await expect
			.element(page.getByTestId("mermaid-diagram"), { timeout: 5_000 })
			.toHaveAttribute("aria-busy", "false");
		const svg = document.querySelector<SVGSVGElement>('[data-qa-id="mermaid-diagram"] svg');
		expect(svg?.getBoundingClientRect().width).toBeLessThan(Number(svg?.getAttribute("width")));
		expect(document.querySelector('[data-qa-id="mermaid-diagram"] .pele-zoom')).toBeNull();
	});

	it("renders a completed Mermaid fence in a reasoning part", async () => {
		renderMarkdownMessage("```mermaid\nflowchart LR\n  Start --> Done\n```", "reasoning");

		await expect
			.element(page.getByTestId("chat-mermaid-card").getByRole("img", { name: "Mermaid diagram" }))
			.toBeVisible();
	});

	it("renders a completed fence whose code also starts an earlier diagram", async () => {
		renderMarkdownMessage(
			"```mermaid\nflowchart LR\n  A --> B\n  B --> C\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```",
		);

		await expect
			.poll(() => document.querySelectorAll('[data-qa-id="mermaid-diagram"]').length)
			.toBe(2);
		expect(document.querySelector('[data-qa-id="chat-mermaid-source"]')).toBeNull();
	});
});

function renderMarkdownMessage(text: string, partType: "text" | "reasoning" = "text") {
	const kiloSdk = createFakeSdk({ featureId: "kilo-ui" });
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": kiloSdk } });
	return render(
		<SdkProvider system={system}>
			<MarkdownMessage text={text} partType={partType} />
		</SdkProvider>,
	);
}
