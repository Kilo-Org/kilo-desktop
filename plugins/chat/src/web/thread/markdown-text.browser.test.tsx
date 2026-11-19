import {
	AssistantRuntimeProvider,
	MessagePrimitive,
	ThreadPrimitive,
	useExternalStoreRuntime,
	useLocalRuntime,
	type ChatModelAdapter,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { act } from "@testing-library/react";
import { createElement, useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { PluginEntry, PluginRegistration } from "@kilo-desktop/kernel";

import { renderInKernel } from "../../test/kernel-harness";
import { MarkdownExtension, type MarkdownExtensionImplementation } from "../../contracts";
import { ChatMarkdownProvider } from "./chat-markdown";
import { ChatLightboxProvider } from "./lightbox/chat-lightbox";
import { MarkdownText } from "./markdown-text";

function pngDataUrl(width: number, height: number): string {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (context) {
		context.fillStyle = "teal";
		context.fillRect(0, 0, width, height);
	}
	return canvas.toDataURL("image/png");
}

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
				workSessionId="wses_1"
				workspaceFolders={[{ path: "/workspace/project", isPrimary: true }]}
			>
				<ChatLightboxProvider>
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
				</ChatLightboxProvider>
			</ChatMarkdownProvider>
		</AssistantRuntimeProvider>
	);
}

function renderMarkdownMessage(
	text: string,
	partType: "text" | "reasoning" = "text",
	rendererPlugins: readonly PluginRegistration[] = [],
) {
	return renderInKernel(<MarkdownMessage text={text} partType={partType} />, { rendererPlugins });
}

let showStreamText: (text: string) => void = () => undefined;

/** A message whose text grows between renders, the way a reply streams. */
function StreamingMessage() {
	const [messages, setMessages] = useState<ThreadMessageLike[]>([
		{ id: "stream", role: "assistant", content: [{ type: "text", text: "" }] },
	]);
	showStreamText = (text) =>
		setMessages([{ id: "stream", role: "assistant", content: [{ type: "text", text }] }]);
	const runtime = useExternalStoreRuntime<ThreadMessageLike>({
		messages,
		isRunning: false,
		onNew: async () => undefined,
		convertMessage: (message) => message,
	});
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ChatMarkdownProvider workSessionId="wses_1" workspaceFolders={[]}>
				<ChatLightboxProvider>
					<ThreadPrimitive.Root>
						<ThreadPrimitive.Messages>
							{() => (
								<MessagePrimitive.Root>
									<MessagePrimitive.Parts components={{ Text: MarkdownText }} />
								</MessagePrimitive.Root>
							)}
						</ThreadPrimitive.Messages>
					</ThreadPrimitive.Root>
				</ChatLightboxProvider>
			</ChatMarkdownProvider>
		</AssistantRuntimeProvider>
	);
}

function codeBlocks(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>('[data-qa-id="chat-code-block"]')];
}

function tokenColors(block: HTMLElement | undefined): Set<string> {
	const tokens = block?.querySelectorAll<HTMLElement>("span[style*='color']") ?? [];
	return new Set([...tokens].map((token) => token.style.color));
}

describe("MarkdownText", () => {
	it("syntax-highlights a fenced code block in its language", async () => {
		const code =
			'class Pool:\n    """Storage."""\n    def __init__(self):\n        self.items = {}\n';
		await renderMarkdownMessage(`\`\`\`py\n${code}\`\`\``);

		await expect
			.poll(() => tokenColors(codeBlocks()[0]).size, { timeout: 10_000 })
			.toBeGreaterThan(1);
		expect(codeBlocks()[0]?.dataset.language).toBe("py");
		expect(codeBlocks()[0]?.textContent).toBe(code);
	});

	it("highlights a fence that is still streaming", async () => {
		await renderMarkdownMessage(
			"```ts\nconst answer: number = 42;\nexport function read() {\n  return answer",
		);

		await expect
			.poll(() => tokenColors(codeBlocks()[0]).size, { timeout: 10_000 })
			.toBeGreaterThan(1);
		expect(codeBlocks()[0]?.textContent).toBe(
			"const answer: number = 42;\nexport function read() {\n  return answer\n",
		);
	});

	it("keeps a fence exact as it grows, tokenizing only what arrives", async () => {
		await renderInKernel(<StreamingMessage />);

		// Markdown appends the newline the fenced block ends with to the code.
		const rendered = (code: string) => (code.endsWith("\n") ? code : `${code}\n`);
		const firstCode = "def f(x):\n";
		const streamed = [
			firstCode,
			"def f(x):\n    return x  # no",
			"def f(x):\n    return x  # note\nx = 2\n",
			"def f(x):\n    return x  # note\nx = 2\ny = f(1)",
		];
		await act(async () => showStreamText(`\`\`\`py\n${firstCode}`));
		await expect
			.poll(() => codeBlocks()[0]?.textContent, { timeout: 10_000 })
			.toBe(rendered(firstCode));
		// The highlighter loads lazily; wait for it so there is a token to track.
		await expect
			.poll(() => codeBlocks()[0]?.querySelector("span"), { timeout: 10_000 })
			.not.toBeNull();
		// Closed lines keep their DOM nodes, so only the tail is rebuilt per chunk.
		const firstToken = codeBlocks()[0]?.querySelector("span");

		for (const code of streamed.slice(1)) {
			await act(async () => showStreamText(`\`\`\`py\n${code}`));
			await expect
				.poll(() => codeBlocks()[0]?.textContent, { timeout: 10_000 })
				.toBe(rendered(code));
		}

		await expect
			.poll(() => tokenColors(codeBlocks()[0]).size, { timeout: 10_000 })
			.toBeGreaterThan(1);
		expect(firstToken?.isConnected).toBe(true);
		expect(codeBlocks()[0]?.querySelector("span")).toBe(firstToken);
	});

	it("keeps a block in an unknown language, or none, as plain text", async () => {
		await renderMarkdownMessage(
			"```py\nx = 1\n```\n\n```not-a-language\nplain words\n```\n\n```\nmore words\n```",
		);

		// The highlighted block shows the highlighter has loaded, so the others had their chance.
		await expect
			.poll(() => tokenColors(codeBlocks()[0]).size, { timeout: 10_000 })
			.toBeGreaterThan(0);
		const [, unknown, unlabeled] = codeBlocks();
		expect(unknown?.textContent).toBe("plain words\n");
		expect(unlabeled?.textContent).toBe("more words\n");
		expect(tokenColors(unknown).size).toBe(0);
		expect(tokenColors(unlabeled).size).toBe(0);
	});

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

	it("opens a rendered diagram in the viewer from the preview or Expand", async () => {
		await renderMarkdownMessage("```mermaid\nflowchart LR\n  Start --> Done\n```");
		await expect.element(page.getByTestId("mermaid-diagram")).toHaveAttribute("aria-busy", "false");

		await page.getByTestId("chat-mermaid-preview").click();
		const viewer = page.getByRole("dialog", { name: "Flowchart" });
		await expect.element(viewer).toBeVisible();
		await expect
			.poll(() => document.querySelector('[data-qa-id="media-lightbox-content"] svg.pele'), {
				timeout: 15_000,
			})
			.not.toBeNull();
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByTestId("media-lightbox")).not.toBeInTheDocument();

		await page.getByTestId("chat-mermaid-expand").click();
		await expect.element(viewer).toBeVisible();
		await expect.element(page.getByTestId("chat-lightbox-copy-source")).toBeVisible();
	});

	it("offers no viewer for a streaming fence, the source view, or a broken diagram", async () => {
		await renderMarkdownMessage("```mermaid\nflowchart LR\n  Start --> Done");
		await expect.element(page.getByTestId("chat-mermaid-source")).toBeVisible();
		expect(document.querySelector('[data-qa-id="chat-mermaid-expand"]')).toBeNull();

		await renderMarkdownMessage("```mermaid\nflowchart LR\n  Start --> Done\n```");
		await expect.element(page.getByTestId("chat-mermaid-expand")).toBeVisible();
		await page.getByRole("button", { name: "Show source" }).click();
		expect(document.querySelector('[data-qa-id="chat-mermaid-expand"]')).toBeNull();

		await renderMarkdownMessage("```mermaid\nnotADiagram\n  nonsense\n```");
		await expect.element(page.getByText("Could not render this Mermaid diagram")).toBeVisible();
		expect(document.querySelector('[data-qa-id="chat-mermaid-expand"]')).toBeNull();
	});

	it("moves between the diagrams of a reply with the arrow keys", async () => {
		await renderMarkdownMessage(
			"```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```",
		);
		await expect
			.poll(() => document.querySelectorAll('[data-qa-id="chat-mermaid-expand"]').length, {
				timeout: 15_000,
			})
			.toBe(2);

		document.querySelector<HTMLElement>('[data-qa-id="chat-mermaid-expand"]')?.click();
		await expect.element(page.getByTestId("media-lightbox-counter")).toHaveTextContent("1 / 2");
		await expect.element(page.getByRole("dialog", { name: "Flowchart" })).toBeVisible();
		await userEvent.keyboard("{ArrowRight}");
		await expect.element(page.getByRole("dialog", { name: "Sequence diagram" })).toBeVisible();
		await expect.element(page.getByTestId("media-lightbox-counter")).toHaveTextContent("2 / 2");
	});

	it("opens an inline image in the viewer, but leaves a linked image to its link", async () => {
		const image = pngDataUrl(40, 20);
		await renderMarkdownMessage(
			`![Teal swatch](${image})\n\n[![Linked swatch](${image})](https://example.com)`,
		);

		await page.getByRole("button", { name: "Open Teal swatch in viewer" }).click();
		await expect.element(page.getByRole("dialog", { name: "Teal swatch" })).toBeVisible();
		expect(document.querySelector('[data-qa-id="media-lightbox-counter"]')).toBeNull();
		const linked = document.querySelector('a [data-qa-id="chat-markdown-image"]');
		expect(linked?.getAttribute("alt")).toBe("Linked swatch");
		expect(linked?.getAttribute("role")).toBeNull();
	});

	it("offers no viewer for an image that fails to load", async () => {
		await renderMarkdownMessage("![Broken](data:image/png;base64,AAAA)");

		const broken = page.getByRole("img", { name: "Broken" });
		await expect.element(broken).toBeInTheDocument();
		await vi.waitFor(() => expect((broken.element() as HTMLImageElement).complete).toBe(true));
		expect(broken.element().getAttribute("role")).toBeNull();
	});

	it("keeps unsafe image sources sanitized", async () => {
		await renderMarkdownMessage("![Script](javascript:alert(1)) ![Page](data:text/html,hi)");

		await expect.element(page.getByRole("img", { name: "Script" })).toBeInTheDocument();
		expect(page.getByRole("img", { name: "Script" }).element().hasAttribute("src")).toBe(false);
		expect(page.getByRole("img", { name: "Page" }).element().hasAttribute("src")).toBe(false);
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
