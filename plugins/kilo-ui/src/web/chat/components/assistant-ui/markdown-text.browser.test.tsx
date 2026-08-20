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

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

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

function MarkdownMessage({ text = "[[badge]]" }: { readonly text?: string }) {
	const runtime = useLocalRuntime(model, {
		initialMessages: [
			{
				role: "assistant",
				content: [{ type: "text", text }],
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
								<MessagePrimitive.Parts components={{ Text: MarkdownText }} />
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
	it("renders chat markdown at the 14px body-text size", async () => {
		const kiloSdk = createFakeSdk({ featureId: "kilo-ui" });
		const system = createFakeFeatureSystem({ sdks: { "kilo-ui": kiloSdk } });
		const { container } = render(
			<SdkProvider system={system}>
				<MarkdownMessage text="Compact chat text" />
			</SdkProvider>,
		);

		await expect.element(page.getByText("Compact chat text")).toBeVisible();
		const markdown = container.querySelector<HTMLElement>(".aui-md");
		if (!markdown) throw new Error("Expected the chat markdown to render.");
		expect(getComputedStyle(markdown).fontSize).toBe("14px");
	});

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
});
