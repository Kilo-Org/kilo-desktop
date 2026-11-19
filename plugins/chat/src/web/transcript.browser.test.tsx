import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { PluginEntry } from "@kilo-desktop/kernel";
import type { ModelsState } from "@kilo-desktop/plugin-core/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	chatPaneObject,
	MarkdownExtension,
	type MarkdownExtensionImplementation,
} from "../contracts";
import { agentPane, chatSummary } from "../test/chat-host";
import {
	assistantMessage,
	FakeKiloServer,
	userMessage,
	type FakeMessage,
} from "../test/fake-kilo-server";
import { SIGNED_IN, SIGNED_OUT } from "../test/kernel-harness";
import { renderChat } from "../test/render-chat";
import { expectPresent } from "../test/transcript";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	// Sonner's toasts are global: left up, they would show in the next test.
	toast.dismiss();
});

const QUESTION = "What does login do?";

function chatWith(parts: Record<string, unknown>[], userPatch: Partial<FakeMessage["info"]> = {}) {
	const user = userMessage("ses_a", "msg_1", QUESTION);
	return [
		{ ...user, info: { ...user.info, ...userPatch } },
		assistantMessage("ses_a", "msg_2", "msg_1", parts),
	];
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

const reply = (text: string) => ({ type: "text", text, time: { start: 3, end: 4 } });

const promptsTo = (server: FakeKiloServer) =>
	server.requestsTo("POST", "/session/ses_a/prompt_async");

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

/** A prompt's recorded file changes (`info.summary.diffs`). */
const CHANGES = { summary: { diffs: [{ file: "login.ts", additions: 3, deletions: 1 }] } };

describe("reverting and retrying", () => {
	it("reverts to a prompt that changed files and puts it back in the composer", async () => {
		const host = await showChat(chatWith([reply("Changed login.")], CHANGES));

		const revert = page.getByTestId("kilo-revert-to-here-button");
		await expect.element(revert).toBeInTheDocument();
		(revert.element() as HTMLElement).click();

		await expect
			.poll(() => host.server.requestsTo("POST", "/session/ses_a/revert")[0]?.body)
			.toMatchObject({ messageID: "msg_1" });
		await expect.element(page.getByTestId("kilo-composer-header")).toBeVisible();
		await expect.element(page.getByTestId("kilo-composer-input")).toHaveTextContent(QUESTION);

		await page.getByTestId("kilo-revert-undo-button").click();
		await expect
			.poll(() => host.server.requestsTo("POST", "/session/ses_a/unrevert").length)
			.toBe(1);
	});

	it("lists the reverted prompts and restores them one at a time", async () => {
		const first = userMessage("ses_a", "msg_1", QUESTION);
		const firstReply = assistantMessage("ses_a", "msg_2", "msg_1", [reply("Changed login.")]);
		const second = userMessage("ses_a", "msg_3", "Now fix signup");
		const secondReply = assistantMessage("ses_a", "msg_4", "msg_3", [reply("Changed signup.")]);
		const withImage = {
			...second,
			info: { ...second.info, ...CHANGES },
			parts: [
				...second.parts,
				{
					id: "msg_3_f",
					sessionID: "ses_a",
					messageID: "msg_3",
					type: "file",
					mime: "image/png",
					filename: "shot.png",
					url: "data:image/png;base64,iVBORw0KGgo=",
				},
				{
					id: "msg_3_d",
					sessionID: "ses_a",
					messageID: "msg_3",
					type: "file",
					mime: "text/csv",
					filename: "data.csv",
					url: "data:text/csv;base64,YSxi",
				},
			],
		};
		const host = await showChat([
			{ ...first, info: { ...first.info, ...CHANGES } },
			firstReply,
			withImage,
			secondReply,
		]);

		const reverts = page.getByTestId("kilo-revert-to-here-button");
		await expect.element(reverts.nth(1)).toBeInTheDocument();
		(reverts.first().element() as HTMLElement).click();
		await expect.element(page.getByTestId("kilo-composer-header")).toBeVisible();
		await page.getByTestId("kilo-revert-messages-toggle").click();
		await expect.element(page.getByTestId("kilo-revert-message-row").nth(1)).toBeVisible();

		await page.getByTestId("kilo-revert-row-restore-button").first().click();

		await expect
			.poll(() => host.server.requestsTo("POST", "/session/ses_a/revert").at(-1)?.body)
			.toMatchObject({ messageID: "msg_3" });
		await expect
			.element(page.getByTestId("kilo-composer-input"))
			.toHaveTextContent("Now fix signup");
	});

	it("warns when the reverted turns changed files the workspace couldn't restore", async () => {
		const host = await showChat(chatWith([reply("Changed login.")], CHANGES));
		host.server.revertWorkspace = "snapshots-disabled";

		const revert = page.getByTestId("kilo-revert-to-here-button");
		await expect.element(revert).toBeInTheDocument();
		(revert.element() as HTMLElement).click();

		await expect
			.element(page.getByText(/File changes were not restored because snapshots are disabled/))
			.toBeVisible();
	});

	it("offers no revert for a prompt that changed nothing", async () => {
		await showChat(chatWith([reply("Nothing to change.")]));

		await expect.element(page.getByText("Nothing to change.")).toBeVisible();
		expect(document.querySelector('[data-qa-id="kilo-revert-to-here-button"]')).toBeNull();
	});

	it("retries a prompt the Gateway refused once the person has signed in", async () => {
		const prompt = userMessage("ses_a", "msg_1", QUESTION);
		const failed = assistantMessage("ses_a", "msg_2", "msg_1", []);
		const host = await showChat(
			[
				prompt,
				{
					...failed,
					info: {
						...failed.info,
						error: {
							name: "APIError",
							data: { message: '{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}' },
						},
					},
				},
			],
			{ identity: SIGNED_IN },
		);

		await expect.element(page.getByTestId("kilo-message-error-signed-in")).toBeVisible();
		await page.getByTestId("kilo-message-error-retry").click();

		await expect
			.poll(() => promptsTo(host.server)[0]?.body)
			.toMatchObject({ messageID: "msg_1", parts: [] });
	});
});

describe("editing a prompt", () => {
	const editButton = () => page.getByTestId("kilo-edit-message-button");

	it("offers Edit on an answered prompt, even one that changed nothing", async () => {
		await showChat(chatWith([reply("Nothing to change.")]));

		await expect.element(editButton()).toBeInTheDocument();
		await expect.element(editButton()).toBeEnabled();
	});

	it("offers no Edit on a prompt that has no answer yet", async () => {
		await showChat([userMessage("ses_a", "msg_1", QUESTION)]);

		await expect.element(page.getByTestId("chat-message-copy")).toBeInTheDocument();
		expect(document.querySelector('[data-qa-id="kilo-edit-message-button"]')).toBeNull();
	});

	it("waits for the agent to finish before editing", async () => {
		const host = await showChat(chatWith([reply("Working.")]));
		await vi.waitFor(() => expect(host.server.openStreams).toBe(1));

		host.server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });

		await expect.element(editButton()).toBeDisabled();
	});

	const withCsv = (): FakeMessage[] => {
		const [prompt, answer] = chatWith([reply("Read it.")]);
		return [
			{
				...prompt!,
				parts: [
					...prompt!.parts,
					{
						id: "msg_1_d",
						sessionID: "ses_a",
						messageID: "msg_1",
						type: "file",
						mime: "text/csv",
						filename: "data.csv",
						url: "data:text/csv;base64,YSxi",
					},
				],
			},
			answer!,
		];
	};
	const editor = () => page.getByTestId("kilo-edit-message-composer");
	const editorInput = () => page.getByTestId("kilo-edit-message-input");
	const editorTiles = () =>
		document.querySelectorAll(
			'[data-qa-id="kilo-edit-message-composer"] [data-qa-id="chat-attachment-tile"]',
		).length;
	const startEditing = async () => {
		await expect.element(editButton()).toBeInTheDocument();
		(editButton().element() as HTMLElement).click();
		await expect.element(editorInput()).toHaveTextContent(QUESTION);
	};
	const changesSent = (server: FakeKiloServer) =>
		server.requestsTo("POST", "/session/ses_a/revert").length + promptsTo(server).length;

	it("edits the prompt in place, starting from what Revert would restore", async () => {
		const host = await showChat(withCsv());

		await startEditing();

		await expect.poll(editorTiles).toBe(1);
		await expect.element(page.getByTestId("kilo-composer-input")).toHaveTextContent("");

		await page.getByTestId("kilo-edit-message-cancel").click();

		await expect.element(editor()).not.toBeInTheDocument();
		await expect.element(page.getByText(QUESTION).first()).toBeInTheDocument();
		expect(changesSent(host.server)).toBe(0);
	});

	it("puts the prompt back as it was on Escape", async () => {
		const host = await showChat(chatWith([reply("Read it.")]));
		await startEditing();
		await expect.element(editorInput()).toHaveFocus();

		await userEvent.keyboard("{Escape}");

		await expect.element(editor()).not.toBeInTheDocument();
		expect(changesSent(host.server)).toBe(0);
	});

	const EDITED = "What does signup do?";
	const revertsAndPrompts = (server: FakeKiloServer) =>
		server.requests
			.filter(
				(request) =>
					request.method === "POST" &&
					(request.path.endsWith("/revert") || request.path.endsWith("/prompt_async")),
			)
			.map((request) => request.path.split("/").at(-1));
	const save = async () => {
		await page.getByTestId("kilo-edit-message-save").click();
		await page.getByTestId("kilo-edit-message-dialog-confirm").click();
	};

	it("offers the composer's agent and model pickers while editing", async () => {
		await showChat(chatWith([reply("Read it.")]));
		await startEditing();

		const toolbar = editor().getByTestId("kilo-model-selector-trigger");
		await expect.element(toolbar).toBeVisible();
		await expect.element(editor().getByTestId("kilo-agent-selector-trigger")).toBeVisible();
	});

	it("opens the / menu where it can be seen, even near the top of the transcript", async () => {
		await showChat(chatWith([reply("Read it.")]));
		await startEditing();

		await userEvent.fill(editorInput(), "/rev");

		const item = editor().getByText("review");
		await expect.element(item).toBeVisible();
		const box = (item.element() as HTMLElement).getBoundingClientRect();
		const hit = document.elementFromPoint(box.left + 4, box.top + box.height / 2);
		expect((item.element() as HTMLElement).contains(hit)).toBe(true);
	});

	it("stops editing when focus moves elsewhere, sending nothing", async () => {
		const host = await showChat(chatWith([reply("Read it.")]));
		await startEditing();
		await expect.element(editorInput()).toHaveFocus();
		await userEvent.fill(editorInput(), EDITED);

		await page.getByTestId("kilo-composer-input").click();

		await expect.element(editor()).not.toBeInTheDocument();
		await expect.element(page.getByText(QUESTION).first()).toBeInTheDocument();
		expect(changesSent(host.server)).toBe(0);
	});

	it("keeps editing while the editor's own pickers are open", async () => {
		await showChat(chatWith([reply("Read it.")]));
		await startEditing();
		await expect.element(editorInput()).toHaveFocus();

		await editor().getByTestId("kilo-agent-selector-trigger").click();
		await expect.element(page.getByTestId("kilo-agent-selector-content")).toBeVisible();
		await userEvent.keyboard("{Escape}");

		await expect.element(page.getByTestId("kilo-agent-selector-content")).not.toBeInTheDocument();
		await expect.element(editor()).toBeInTheDocument();
	});

	it("asks before saving, and keeps editing when the person backs out", async () => {
		const host = await showChat(chatWith([reply("Read it.")]));
		await startEditing();
		await userEvent.fill(editorInput(), EDITED);

		await page.getByTestId("kilo-edit-message-save").click();
		await expect.element(page.getByTestId("kilo-edit-message-dialog")).toBeVisible();
		await page.getByTestId("kilo-edit-message-dialog-cancel").click();

		await expect.element(page.getByTestId("kilo-edit-message-dialog")).not.toBeInTheDocument();
		await expect.element(editorInput()).toHaveTextContent(EDITED);
		expect(changesSent(host.server)).toBe(0);
	});

	it("saves the edit by reverting to the prompt, then sending the edit", async () => {
		const host = await showChat(withCsv());
		await startEditing();
		await expect.poll(editorTiles).toBe(1);

		await userEvent.fill(editorInput(), EDITED);
		await save();

		await expect.poll(() => revertsAndPrompts(host.server)).toEqual(["revert", "prompt_async"]);
		expect(host.server.requestsTo("POST", "/session/ses_a/revert")[0]?.body).toMatchObject({
			messageID: "msg_1",
		});
		expect(promptsTo(host.server)[0]?.body).toMatchObject({
			parts: expect.arrayContaining([
				expect.objectContaining({ type: "text", text: EDITED }),
				expect.objectContaining({ type: "file", filename: "data.csv" }),
			]),
		});
		await expect.element(editor()).not.toBeInTheDocument();
	});

	it("says the edit undoes file changes only when the turns from this prompt on made some", async () => {
		await showChat(chatWith([reply("Changed login.")], CHANGES));
		await startEditing();
		await page.getByTestId("kilo-edit-message-save").click();

		await expect.element(page.getByText(/undoing their file changes/)).toBeVisible();
		await expect
			.element(page.getByTestId("kilo-edit-message-dialog-confirm"))
			.toHaveTextContent("Revert and send");
	});

	it("tells the person their files stay as they are when nothing changed from this prompt on", async () => {
		await showChat(chatWith([reply("Read it.")]));
		await startEditing();
		await page.getByTestId("kilo-edit-message-save").click();

		await expect.element(page.getByText(/your files stay as they are/)).toBeVisible();
		expect(document.body.textContent).not.toContain("undoing their file changes");
		await expect
			.element(page.getByTestId("kilo-edit-message-dialog-confirm"))
			.toHaveTextContent("Send edit");
	});

	it("raises no warning about unrestored files after editing a prompt that changed none", async () => {
		const warning = vi.spyOn(toast, "warning");
		const host = await showChat(chatWith([reply("Read it.")]));
		host.server.revertWorkspace = "unavailable";
		await startEditing();

		await userEvent.fill(editorInput(), EDITED);
		await save();

		await expect.poll(() => revertsAndPrompts(host.server)).toEqual(["revert", "prompt_async"]);
		await expect.element(page.getByTestId("kilo-composer-header")).toBeVisible();
		// The shelf's notice is raised in an effect once it shows; flush it.
		await act(async () => {});
		expect(warning).not.toHaveBeenCalled();
	});

	it("asks to save the edit on Enter", async () => {
		const host = await showChat(chatWith([reply("Read it.")]));
		await startEditing();

		await userEvent.fill(editorInput(), EDITED);
		await userEvent.keyboard("{Enter}");
		await expect.element(page.getByTestId("kilo-edit-message-dialog")).toBeVisible();
		expect(changesSent(host.server)).toBe(0);
		await page.getByTestId("kilo-edit-message-dialog-confirm").click();

		await expect.poll(() => revertsAndPrompts(host.server)).toEqual(["revert", "prompt_async"]);
	});

	it("keeps editing when the revert fails, sending nothing", async () => {
		const host = await showChat(chatWith([reply("Read it.")]));
		host.server.failReverts = true;
		await startEditing();

		await userEvent.fill(editorInput(), EDITED);
		await save();

		await expect.element(page.getByText("Could not edit the message.")).toBeVisible();
		await expect.element(editorInput()).toHaveTextContent(EDITED);
		expect(revertsAndPrompts(host.server)).toEqual(["revert"]);
	});

	it("reports an edit it can't send after the revert, leaving the composer's draft alone", async () => {
		const host = await showChat(withCsv());
		host.server.failPrompts = true;
		const composerInput = page.getByTestId("kilo-composer-input");
		await userEvent.fill(composerInput, "My own draft");
		await startEditing();
		await expect.poll(editorTiles).toBe(1);

		await userEvent.fill(editorInput(), EDITED);
		await save();

		await expect.element(page.getByText("Could not edit the message.")).toBeVisible();
		await expect.element(editor()).not.toBeInTheDocument();
		await expect.element(composerInput).toHaveTextContent("My own draft");
		expect(
			document.querySelectorAll(
				'[data-slot="aui_composer-shell"] [data-qa-id="chat-attachment-tile"]',
			).length,
		).toBe(0);
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
		const prompt = userMessage("ses_a", "msg_1", QUESTION);
		const failed = assistantMessage("ses_a", "msg_2", "msg_1", []);
		server.addChat({
			id: "ses_a",
			directory: "/projects/app",
			title: "Chat",
			messages: [
				prompt,
				{
					...failed,
					info: {
						...failed.info,
						error: {
							name: "APIError",
							data: { message: '{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}' },
						},
					},
				},
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
