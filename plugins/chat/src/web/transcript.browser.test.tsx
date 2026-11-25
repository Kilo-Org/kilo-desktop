import type { SessionMessageAssistant, SessionMessageInfo } from "@kilocode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { PluginEntry } from "@kilo-desktop/kernel";
import type { ModelsState } from "@kilo-desktop/plugin-core/contracts";

import {
	chatPaneObject,
	MarkdownExtension,
	type MarkdownExtensionImplementation,
} from "../contracts";
import { agentPane, chatSummary } from "../test/chat-host";
import { FakeKilo2Server } from "../test/kilo2/fake-kilo2-server";
import {
	assistantMessage,
	idleMessage,
	session,
	text,
	tool,
	userMessage,
} from "../test/kilo2/fixtures";
import { SIGNED_IN, SIGNED_OUT } from "../test/kernel-harness";
import { renderChat } from "../test/render-chat";
import { expectPresent } from "../test/transcript";

afterEach(() => {
	vi.unstubAllGlobals();
});

const QUESTION = "What does login do?";

/** A finished turn answering with `content`. */
const answer = (content: SessionMessageAssistant["content"]): SessionMessageInfo[] => [
	assistantMessage(content, { finish: "stop", rawFinish: "stop" }),
	idleMessage(),
];

/** A finished turn that edited login.ts (+3 −1) before answering `reply`. */
const editingAnswer = (reply: string) =>
	answer([
		tool(
			"edit",
			{ path: "/projects/app/login.ts", oldString: "a", newString: "b" },
			"Edit applied",
			{
				state: {
					status: "completed",
					input: { path: "/projects/app/login.ts", oldString: "a", newString: "b" },
					content: [{ type: "text", text: "Edit applied" }],
					metadata: {
						files: [
							{ file: "login.ts", patch: "", additions: 3, deletions: 1, status: "modified" },
						],
					},
				},
			},
		),
		text(reply),
	]);

/** The prompt and a turn that ended in the Gateway's sign-in error. */
const refusedByGateway = (): SessionMessageInfo[] => {
	const error = {
		type: "APIError",
		message: '{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}',
	};
	return [
		userMessage(QUESTION, { id: "msg_1" }),
		assistantMessage([], { finish: "error", error }),
		idleMessage("failed", error),
	];
};

async function showChat(
	messages: SessionMessageInfo[],
	options: Omit<Parameters<typeof renderChat>[0] & object, "server"> = {},
) {
	const server = new FakeKilo2Server();
	server.addChat(session("ses_a", { title: "Chat" }), messages);
	const host = await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
		...options,
	});
	await expect.element(page.getByText(QUESTION).first()).toBeInTheDocument();
	return host;
}

/** A plugin contributing `extensions`, with renderer and main entries. */
function contributor(
	extensions: Record<string, unknown[]>,
	entries: { web?: PluginEntry; main?: PluginEntry },
) {
	return {
		manifest: {
			manifestVersion: 1,
			id: "acme.tools",
			displayName: "Acme tools",
			version: "1.0.0",
			requires: { "kilo.chat/markdown-extension": "optional" },
			contributes: { extensions },
		},
		...entries,
	};
}

describe("the markdown-extension point", () => {
	it("decorates the transcript's markdown, knowing where it is", async () => {
		const shout: MarkdownExtensionImplementation = (context) => ({
			decorateComponents: (next) => ({
				...next,
				strong: ({ children }) => (
					<strong data-qa-id="acme-shout" data-session={context.workSessionId}>
						{children}!
					</strong>
				),
			}),
		});
		await showChat([userMessage(QUESTION), ...answer([text("It posts **credentials**.")])], {
			plugins: [
				contributor(
					{ "kilo.chat/markdown-extension": [{ id: "shout" }] },
					{
						web: {
							activate(sdk) {
								sdk.extensions.implement(MarkdownExtension, "shout", shout);
							},
						},
					},
				),
			],
		});

		await expect.element(page.getByTestId("acme-shout")).toHaveTextContent("credentials!");
		expect(expectPresent('[data-qa-id="acme-shout"]').dataset.session).toBe("wses_1");
	});
});

describe("reverting and retrying", () => {
	it("reverts to a prompt that changed files and puts it back in the composer", async () => {
		const host = await showChat([
			userMessage(QUESTION, { id: "msg_1" }),
			...editingAnswer("Changed login."),
		]);

		const revert = page.getByTestId("kilo-revert-to-here-button");
		await expect.element(revert).toBeInTheDocument();
		(revert.element() as HTMLElement).click();

		await expect
			.poll(() => host.server.requestsTo("POST", "/api/session/ses_a/revert/stage")[0]?.body)
			.toMatchObject({ messageID: "msg_1" });
		await expect.element(page.getByTestId("kilo-composer-header")).toBeVisible();
		await expect.element(page.getByTestId("kilo-composer-input")).toHaveTextContent(QUESTION);

		await page.getByTestId("kilo-revert-undo-button").click();
		await expect
			.poll(() => host.server.requestsTo("DELETE", "/api/session/ses_a/revert").length)
			.toBe(1);
	});

	it("lists the reverted prompts and restores them one at a time", async () => {
		const host = await showChat([
			userMessage(QUESTION, { id: "msg_1" }),
			...editingAnswer("Changed login."),
			userMessage("Now fix signup", {
				id: "msg_3",
				files: [
					{
						data: "iVBORw0KGgo=",
						mime: "image/png",
						source: { type: "inline" },
						name: "shot.png",
					},
					{ data: "YSxi", mime: "text/csv", source: { type: "inline" }, name: "data.csv" },
				],
			}),
			...editingAnswer("Changed signup."),
		]);

		const reverts = page.getByTestId("kilo-revert-to-here-button");
		await expect.element(reverts.nth(1)).toBeInTheDocument();
		(reverts.first().element() as HTMLElement).click();
		await expect.element(page.getByTestId("kilo-composer-header")).toBeVisible();
		await page.getByTestId("kilo-revert-messages-toggle").click();
		await expect.element(page.getByTestId("kilo-revert-message-row").nth(1)).toBeVisible();

		await page.getByTestId("kilo-revert-row-restore-button").first().click();

		await expect
			.poll(() => host.server.requestsTo("POST", "/api/session/ses_a/revert/stage").at(-1)?.body)
			.toMatchObject({ messageID: "msg_3" });
		await expect
			.element(page.getByTestId("kilo-composer-input"))
			.toHaveTextContent("Now fix signup");
	});

	it("offers no revert for a prompt that changed nothing", async () => {
		await showChat([userMessage(QUESTION), ...answer([text("Nothing to change.")])]);

		await expect.element(page.getByText("Nothing to change.")).toBeVisible();
		expect(document.querySelector('[data-qa-id="kilo-revert-to-here-button"]')).toBeNull();
	});

	it("retries a prompt the Gateway refused once the person has signed in", async () => {
		const host = await showChat(refusedByGateway(), { identity: SIGNED_IN });

		await expect.element(page.getByTestId("kilo-message-error-signed-in")).toBeVisible();
		await page.getByTestId("kilo-message-error-retry").click();

		await expect.poll(() => host.server.promptsTo("ses_a")[0]?.text).toBe(QUESTION);
	});
});

/** kilo.core's models with only Kilo's gateway and its Auto model, configured as the default. */
const KILO_AUTO_ONLY: Partial<ModelsState> = {
	aiProviders: {
		kilo: { id: "kilo", name: "Kilo", connected: true, env: [], canDisconnect: false },
	},
	models: {
		"kilo/auto": {
			aiProviderId: "kilo",
			modelId: "auto",
			name: "Auto",
			variants: [],
			attachments: true,
			reasoning: false,
			free: false,
			byok: false,
		},
	},
	defaults: { kilo: "auto" },
	configuredModel: { aiProviderId: "kilo", modelId: "auto" },
};

describe("a Kilo Gateway model refused while signed out", () => {
	it("offers to connect", async () => {
		const host = await showChat(refusedByGateway(), {
			identity: SIGNED_OUT,
			models: KILO_AUTO_ONLY,
		});

		await page.getByTestId("kilo-message-error-signin").click();

		await vi.waitFor(() => expect(host.signIn).toHaveBeenCalled());
	});
});
