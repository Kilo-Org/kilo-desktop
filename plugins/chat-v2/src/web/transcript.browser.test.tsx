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
import {
	assistantMessage,
	FakeKiloServer,
	textContent,
	userMessage,
	type FakeMessage,
} from "../test/fake-kilo-server";
import { SIGNED_IN, SIGNED_OUT } from "../test/kernel-harness";
import { renderChat } from "../test/render-chat";
import { expectPresent } from "../test/transcript";

afterEach(() => {
	vi.unstubAllGlobals();
});

const QUESTION = "What does login do?";

function chatWith(content: Record<string, unknown>[], userPatch: Partial<FakeMessage> = {}) {
	return [{ ...userMessage("msg_1", QUESTION), ...userPatch }, assistantMessage("msg_2", content)];
}

async function showChat(
	messages: FakeMessage[],
	options: Omit<Parameters<typeof renderChat>[0] & object, "server"> = {},
) {
	const server = new FakeKiloServer();
	server.addChat({ id: "ses_a", directory: "/projects/app", title: "Chat", messages });
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

const reply = textContent;

const promptsTo = (server: FakeKiloServer) =>
	server.requestsTo("POST", "/api/session/ses_a/prompt");

/** A Gateway refusal of a paid model, as the failed reply carries it. */
const PAID_MODEL_REFUSAL = {
	error: { type: "APIError", message: '{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}' },
};

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
		await showChat(chatWith([reply("It posts **credentials**.")]), {
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
	/** A reply whose step changed login.ts (its `snapshot.files`), answering `msg_1`. */
	const changedLogin = (id: string, text: string) => ({
		...assistantMessage(id, [reply(text)]),
		snapshot: { start: "h0", end: "h1", files: ["login.ts"] },
	});

	it("reverts to a prompt that changed files and puts it back in the composer", async () => {
		const host = await showChat([
			userMessage("msg_1", QUESTION),
			changedLogin("msg_2", "Changed login."),
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
		const first = userMessage("msg_1", QUESTION);
		const firstReply = changedLogin("msg_2", "Changed login.");
		const second = userMessage("msg_3", "Now fix signup");
		const secondReply = changedLogin("msg_4", "Changed signup.");
		const withImage = {
			...second,
			files: [
				{ data: "iVBORw0KGgo=", name: "shot.png", mime: "image/png", source: { type: "inline" } },
				{ data: "YSxi", name: "data.csv", mime: "text/csv", source: { type: "inline" } },
			],
		};
		const host = await showChat([first, firstReply, withImage, secondReply]);

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
		await showChat(chatWith([reply("Nothing to change.")]));

		await expect.element(page.getByText("Nothing to change.")).toBeVisible();
		expect(document.querySelector('[data-qa-id="kilo-revert-to-here-button"]')).toBeNull();
	});

	it("retries a prompt the Gateway refused once the person has signed in", async () => {
		const host = await showChat(
			[
				userMessage("msg_1", QUESTION),
				assistantMessage("msg_2", [], { finish: "error", ...PAID_MODEL_REFUSAL }),
			],
			{ identity: SIGNED_IN },
		);

		await expect.element(page.getByTestId("kilo-message-error-signed-in")).toBeVisible();
		await page.getByTestId("kilo-message-error-retry").click();

		// The prompt goes again as a new one, so the model runs again.
		await expect.poll(() => promptsTo(host.server)[0]?.body).toEqual({ text: QUESTION });
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
		const server = new FakeKiloServer();
		server.addChat({
			id: "ses_a",
			directory: "/projects/app",
			title: "Chat",
			messages: [
				userMessage("msg_1", QUESTION),
				assistantMessage("msg_2", [], { finish: "error", ...PAID_MODEL_REFUSAL }),
			],
		});
		const host = await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
			identity: SIGNED_OUT,
			models: KILO_AUTO_ONLY,
		});

		await page.getByTestId("kilo-message-error-signin").click();

		await vi.waitFor(() => expect(host.signIn).toHaveBeenCalled());
	});
});
