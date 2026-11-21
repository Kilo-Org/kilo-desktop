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
import { useMemo, useSyncExternalStore } from "react";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { PluginEntry, PluginRegistration } from "@kilo-desktop/kernel";

import { renderInKernel } from "../../test/kernel-harness";
import { MarkdownExtension, type MarkdownExtensionImplementation } from "../../contracts";
import { ChatMarkdownProvider } from "./chat-markdown";
import { ChatLightboxProvider } from "./lightbox/chat-lightbox";
import { MarkdownText } from "./markdown-text";

const model: ChatModelAdapter = {
	async run() {
		return { content: [] };
	},
};

const testBadge: MarkdownExtensionImplementation = () => ({
	components: {
		a: (html) =>
			html.includes('href="/extension/badge"')
				? '<button type="button" data-qa-id="test-markdown-extension">Plugin badge</button>'
				: html,
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

/** The streamed reply's text, held outside React so a test can grow it. */
const streamedText = (() => {
	let text = "";
	const listeners = new Set<() => void>();
	return {
		read: () => text,
		show(next: string) {
			text = next;
			for (const listener of listeners) listener();
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
})();

/** A message whose text grows between renders, the way a reply streams. */
function StreamingMessage({ running = false }: { readonly running?: boolean }) {
	const text = useSyncExternalStore(streamedText.subscribe, streamedText.read);
	const messages = useMemo<ThreadMessageLike[]>(
		() => [{ id: "stream", role: "assistant", content: [{ type: "text", text }] }],
		[text],
	);
	const runtime = useExternalStoreRuntime<ThreadMessageLike>({
		messages,
		isRunning: running,
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

/** A reply still streaming in, showing `text` so far. */
function renderStreamingMessage(text: string) {
	streamedText.show(text);
	return renderInKernel(<StreamingMessage running />);
}

function drawnDiagrams(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>('[data-markdown="mermaid"]')].filter(
		(diagram) => diagram.querySelector("svg"),
	);
}

function codeBlocks(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>('[data-markdown="code-block"] pre code')];
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
		expect(codeBlocks()[0]?.closest<HTMLElement>("[data-language]")?.dataset.language).toBe("py");
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

	it("keeps a fence exact as it grows", async () => {
		streamedText.show("");
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
		await act(async () => streamedText.show(`\`\`\`py\n${firstCode}`));
		await expect
			.poll(() => codeBlocks()[0]?.textContent, { timeout: 10_000 })
			.toBe(rendered(firstCode));

		for (const code of streamed.slice(1)) {
			await act(async () => streamedText.show(`\`\`\`py\n${code}`));
			await expect
				.poll(() => codeBlocks()[0]?.textContent, { timeout: 10_000 })
				.toBe(rendered(code));
		}

		await expect
			.poll(() => tokenColors(codeBlocks()[0]).size, { timeout: 10_000 })
			.toBeGreaterThan(1);
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

	it("applies a contributed element hook", async () => {
		await renderMarkdownMessage("[Badge](/extension/badge)", "text", [badgePlugin]);

		await expect
			.element(page.getByTestId("test-markdown-extension"))
			.toHaveTextContent("Plugin badge");
	});

	it("draws a completed Mermaid fence in its code-block frame", async () => {
		await renderMarkdownMessage("```mermaid\nflowchart LR\n  Start --> Done\n```");

		await expect.element(page.getByTestId("markdown-mermaid-expand")).toBeVisible();
		expect(drawnDiagrams()).toHaveLength(1);
		expect(document.querySelector('[data-markdown="code-header"]')?.textContent).toContain(
			"mermaid",
		);
	});

	it("keeps a streaming fence unexpandable until it closes", async () => {
		await renderStreamingMessage("```mermaid\nflowchart LR\n  Start --> Done\n  Done --> ");

		await expect.poll(() => drawnDiagrams().length, { timeout: 10_000 }).toBe(1);
		expect(document.querySelector('[data-qa-id="markdown-mermaid-expand"]')).toBeNull();
	});

	it.each([
		["a list item", "1. Step one\n\n   ```mermaid\n   flowchart LR\n     Start --> Done\n   ```"],
		["a blockquote", "> ```mermaid\n> flowchart LR\n>   Start --> Done\n> ```"],
		["a tilde fence", "~~~mermaid\nflowchart LR\n  Start --> Done\n~~~"],
		["a longer backtick fence", "````mermaid\nflowchart LR\n  Start --> Done\n````"],
		["a reasoning part", "```mermaid\nflowchart LR\n  Start --> Done\n```"],
	])("draws a completed Mermaid fence in %s", async (place, text) => {
		await renderMarkdownMessage(text, place === "a reasoning part" ? "reasoning" : "text");

		await expect.poll(() => drawnDiagrams().length, { timeout: 10_000 }).toBe(1);
	});

	it("shows a broken diagram as code, with nothing to expand", async () => {
		await renderMarkdownMessage("```mermaid\nnotADiagram\n  nonsense\n```");

		await expect.element(page.getByText("nonsense", { exact: false })).toBeVisible();
		expect(drawnDiagrams()).toHaveLength(0);
		expect(document.querySelector('[data-qa-id="markdown-mermaid-expand"]')).toBeNull();
	});

	it("opens a drawn diagram in the viewer from the diagram or Expand", async () => {
		await renderMarkdownMessage("```mermaid\nflowchart LR\n  Start --> Done\n```");
		await expect.element(page.getByTestId("markdown-mermaid-expand")).toBeVisible();

		drawnDiagrams()[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		const viewer = page.getByRole("dialog", { name: "Flowchart" });
		await expect.element(viewer).toBeVisible();
		await expect
			.poll(() => document.querySelector('[data-qa-id="media-lightbox-content"] svg.pele'), {
				timeout: 15_000,
			})
			.not.toBeNull();
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByTestId("media-lightbox")).not.toBeInTheDocument();

		await page.getByTestId("markdown-mermaid-expand").click();
		await expect.element(viewer).toBeVisible();
		await expect.element(page.getByTestId("chat-lightbox-copy-source")).toBeVisible();
	});

	it("moves between the diagrams of a reply with the arrow keys", async () => {
		await renderMarkdownMessage(
			"```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```",
		);
		await expect
			.poll(() => document.querySelectorAll('[data-qa-id="markdown-mermaid-expand"]').length, {
				timeout: 15_000,
			})
			.toBe(2);

		document.querySelector<HTMLElement>('[data-qa-id="markdown-mermaid-expand"]')?.click();
		await expect.element(page.getByTestId("media-lightbox-counter")).toHaveTextContent("1 / 2");
		await expect.element(page.getByRole("dialog", { name: "Flowchart" })).toBeVisible();
		await userEvent.keyboard("{ArrowRight}");
		await expect.element(page.getByRole("dialog", { name: "Sequence diagram" })).toBeVisible();
		await expect.element(page.getByTestId("media-lightbox-counter")).toHaveTextContent("2 / 2");
	});

	it("drops inline data images and unsafe image sources", async () => {
		await renderMarkdownMessage(
			"Images: ![Swatch](data:image/png;base64,AAAA) ![Script](javascript:alert(1)) ![Page](data:text/html,hi)",
		);

		await expect.element(page.getByText("Images:", { exact: false })).toBeVisible();
		expect(document.querySelector('[data-qa-id="chat-markdown"] img')).toBeNull();
	});

	it("draws a completed fence whose code also starts an earlier diagram", async () => {
		await renderMarkdownMessage(
			"```mermaid\nflowchart LR\n  A --> B\n  B --> C\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```",
		);

		await expect.poll(() => drawnDiagrams().length, { timeout: 10_000 }).toBe(2);
	});
});
