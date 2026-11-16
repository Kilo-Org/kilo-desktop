import { FileTextIcon, GitBranchIcon, SparklesIcon } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelCommand, type CommandHandler, type PluginEntry } from "@kilo-desktop/kernel";
import {
	EMPTY_WORK_SESSION_PANES,
	WorkSessionsWindow,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { testWebEntry } from "@kilo-desktop/plugin-work-sessions/testing";
import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	AutoApprove,
	Composer,
	ComposerAction,
	ComposerMention,
	Drafts,
	chatPaneObject,
	slashCommandHandler,
	type ClientSlashCommandContext,
	type ComposerContext,
} from "../../contracts";
import { agentPane, chatSummary, workSession } from "../../test/chat-host";
import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";

// The shell the test host renders sits over the pane (its sidebar rail over
// the left edge where popups open, its status bar over the footer).
beforeEach(() => {
	const style = document.createElement("style");
	style.dataset.test = "rail";
	style.textContent = [
		'[data-slot="sidebar-rail"] { pointer-events: none !important; }',
		'[data-qa-id^="pane-"] { position: relative; z-index: 40; }',
	].join("\n");
	document.head.append(style);
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.querySelector('style[data-test="rail"]')?.remove();
	// Sonner's toasts are global: left up, they cover the next test's composer.
	toast.dismiss();
});

const input = () => page.getByTestId("kilo-composer-input");
const sendButton = () => page.getByTestId("kilo-composer-send");

/** A plugin contributing to kilo.chat's composer points from its renderer entry. */
function contributor(extensions: Record<string, unknown[]>, web: PluginEntry) {
	return {
		manifest: {
			manifestVersion: 1,
			id: "acme.tools",
			displayName: "Acme tools",
			version: "1.0.0",
			requires: { "kilo.chat/composer-action": "optional" },
			contributes: { extensions },
		},
		web,
	};
}

function promptBody(host: Awaited<ReturnType<typeof renderChat>>, chatId: string) {
	return host.server.requestsTo("POST", `/session/${chatId}/prompt_async`).at(-1)?.body as
		| Record<string, unknown>
		| undefined;
}

describe("the composer's pickers", () => {
	it("sends with the picked agent and model, and remembers a draft's model for new chats", async () => {
		const host = await renderChat();
		const agent = page.getByTestId("kilo-agent-selector-trigger");
		await expect.element(agent).toHaveTextContent("Code");

		await agent.click();
		await page.getByTestId("kilo-agent-selector-item-plan").click();
		await expect.element(agent).toHaveTextContent("Plan");

		const model = page.getByTestId("kilo-model-selector-trigger");
		await expect.poll(() => model.element().textContent).toContain("Fast One");
		await model.click();
		await page.getByTestId("kilo-model-option-acme/deep-2").click();
		await expect.poll(() => model.element().textContent).toContain("Deep Two");

		await userEvent.fill(input(), "Plan the work");
		await sendButton().click();

		await expect
			.poll(() => promptBody(host, "ses_new_1"))
			.toMatchObject({
				agent: "plan",
				model: { providerID: "acme", modelID: "deep-2" },
			});
		await expect
			.poll(() => host.core.models().state.preferences.byAgent.plan)
			.toEqual({ aiProviderId: "acme", modelId: "deep-2" });
	});

	it("cycles the agent with Shift+Tab", async () => {
		await renderChat();
		const agent = page.getByTestId("kilo-agent-selector-trigger");
		await expect.element(agent).toHaveTextContent("Code");

		await input().click();
		await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
		await expect.element(agent).toHaveTextContent("Plan");
	});

	it("shows the agent Kilo recorded for a chat the pane opens", async () => {
		const server = new FakeKiloServer();
		server.addChat({ id: "ses_a", directory: "/projects/app", title: "Chat", agent: "plan" });
		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});

		await expect.element(page.getByTestId("kilo-agent-selector-trigger")).toHaveTextContent("Plan");
	});

	it("lists an AI provider kilo.core found since the picker last opened", async () => {
		const host = await renderChat();
		const model = page.getByTestId("kilo-model-selector-trigger");
		await expect.poll(() => model.element().textContent).toContain("Fast One");

		host.core.calls.refreshModels.mockImplementation(() => {
			const models = host.core.models();
			models.setState({
				...models.state,
				aiProviders: {
					...models.state.aiProviders,
					stub: {
						id: "stub",
						name: "Stub",
						connected: true,
						source: "api",
						env: [],
						canDisconnect: true,
					},
				},
				models: {
					...models.state.models,
					"stub/m1": {
						aiProviderId: "stub",
						modelId: "m1",
						name: "Stub One",
						variants: [],
						attachments: true,
						reasoning: false,
						free: false,
						byok: false,
					},
				},
			});
		});
		await model.click();

		await expect.element(page.getByTestId("kilo-model-selector-rail-stub")).toBeVisible();
		expect(host.core.calls.refreshModels).toHaveBeenCalled();
	});

	it("switches the approval mode for every chat", async () => {
		const host = await renderChat();
		await page.getByTestId("kilo-approval-selector-trigger").click();
		await page.getByTestId("kilo-approval-selector-item-auto").click();

		const autoApprove = host.host.main.kernelSdk.domainObjects.get(AutoApprove)!;
		await expect.poll(() => autoApprove.getState().mode).toBe("auto");
	});
});

describe("slash commands", () => {
	it("runs a known /command through the chat's command call", async () => {
		const host = await renderChat();
		await expect.element(page.getByTestId("kilo-agent-selector-trigger")).toBeVisible();

		await userEvent.fill(input(), "/review the diff");
		await sendButton().click();

		await expect
			.poll(() => host.server.requestsTo("POST", "/session/ses_new_1/command").at(-1)?.body)
			.toMatchObject({ command: "review", arguments: "the diff", agent: "code" });
		expect(host.server.requestsTo("POST", "/session/ses_new_1/prompt_async")).toEqual([]);
	});

	it("groups the / menu by source once there are skills too, and searches all of them", async () => {
		const server = new FakeKiloServer();
		server.commands = [
			...server.commands,
			{ name: "tidy", description: "Tidy imports", source: "skill", template: "", hints: [] },
		];
		await renderChat({ server });
		await expect.element(page.getByTestId("kilo-agent-selector-trigger")).toBeVisible();

		await input().click();
		await userEvent.keyboard("/");
		await page.getByText("Skills").click();
		await expect.element(page.getByText("Tidy imports")).toBeVisible();

		await userEvent.keyboard("ti");
		await expect.element(page.getByText("Tidy imports")).toBeVisible();
	});
});

describe("client slash commands", () => {
	/** A pane on an existing chat in /projects/app, its model loaded. */
	async function renderOnChat(server = new FakeKiloServer()) {
		server.addChat({
			id: "ses_a",
			directory: "/projects/app",
			title: "Chat",
			messages: [
				userMessage("ses_a", "msg_u1", "Hello"),
				assistantMessage("ses_a", "msg_a1", "msg_u1", [
					{ type: "text", text: "Done.", time: { start: 1, end: 2 } },
				]),
			],
		});
		const host = await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});
		await expect.element(page.getByText("Done.")).toBeVisible();
		await expect
			.poll(() => page.getByTestId("kilo-model-selector-trigger").element().textContent)
			.toContain("Fast One");
		return host;
	}

	const summarizeCalls = (host: Awaited<ReturnType<typeof renderChat>>) =>
		host.server.requestsTo("POST", "/session/ses_a/summarize");

	async function expectOneCompaction(host: Awaited<ReturnType<typeof renderChat>>) {
		await expect.poll(() => summarizeCalls(host).length).toBe(1);
		expect(summarizeCalls(host)[0]).toMatchObject({
			directory: "/projects/app",
			body: { providerID: "acme", modelID: "fast-1" },
		});
		expect(host.server.requestsTo("POST", "/session/ses_a/prompt_async")).toEqual([]);
		expect(host.server.requestsTo("POST", "/session/ses_a/command")).toEqual([]);
		await expect.element(input()).toHaveTextContent("");
		expect(summarizeCalls(host)).toHaveLength(1);
	}

	it("lists Actions while the server's commands are still loading", async () => {
		const server = new FakeKiloServer();
		server.commandsGate = new Promise(() => undefined);
		await renderChat({ server });
		await expect.element(page.getByTestId("kilo-agent-selector-trigger")).toBeVisible();

		await input().click();
		await userEvent.keyboard("/comp");
		await expect
			.element(page.getByText("Summarize the chat so far to free up context"))
			.toBeVisible();
	});

	it("compacts the chat when /compact is picked from the menu", async () => {
		const host = await renderOnChat();
		await input().click();
		await userEvent.keyboard("/");
		await page.getByText("Actions").click();
		await page.getByText("Summarize the chat so far to free up context").click();

		await expectOneCompaction(host);
	});

	it("compacts once for /compact or an alias followed by Enter", async () => {
		const host = await renderOnChat();
		await input().click();
		await userEvent.keyboard("/compact");
		await userEvent.keyboard("{Enter}");
		await expectOneCompaction(host);

		await userEvent.keyboard("/smol");
		await userEvent.keyboard("{Enter}");
		await expect.poll(() => summarizeCalls(host).length).toBe(2);
	});

	it("compacts, sending nothing, when /compact is sent with arguments or the Send button", async () => {
		const host = await renderOnChat();
		await input().click();
		await userEvent.keyboard("/compact now please");
		await userEvent.keyboard("{Enter}");
		await expectOneCompaction(host);

		await userEvent.fill(input(), "/compact");
		await sendButton().click();
		await expect.poll(() => summarizeCalls(host).length).toBe(2);
		expect(host.server.requestsTo("POST", "/session/ses_a/prompt_async")).toEqual([]);
	});

	it("hides a server command with a client command's name", async () => {
		const server = new FakeKiloServer();
		server.commands = [
			...server.commands,
			{ name: "compact", description: "The server's compact", template: "", hints: [] },
		];
		await renderChat({ server });
		await expect.element(page.getByTestId("kilo-agent-selector-trigger")).toBeVisible();

		await input().click();
		await userEvent.keyboard("/compact");
		await expect
			.element(page.getByText("Summarize the chat so far to free up context"))
			.toBeVisible();
		await expect.element(page.getByText("The server's compact")).not.toBeInTheDocument();
	});

	it("explains instead of compacting a chat that hasn't started", async () => {
		const host = await renderChat();
		await expect.element(page.getByTestId("kilo-agent-selector-trigger")).toBeVisible();
		await input().click();
		await userEvent.keyboard("/compact");
		await userEvent.keyboard("{Enter}");
		await expect.element(page.getByText("Nothing to compact yet")).toBeVisible();
		expect(host.server.requests.some((request) => request.path.endsWith("/summarize"))).toBe(false);
	});

	it("explains instead of compacting a chat mid-turn", async () => {
		const server = new FakeKiloServer();
		const onChat = await renderOnChat(server);
		await vi.waitFor(() => expect(server.openStreams).toBe(1));
		server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();
		await input().click();
		await userEvent.keyboard("/compact");
		await userEvent.keyboard("{Enter}");
		await expect.element(page.getByText("Wait for the agent to finish")).toBeVisible();
		expect(summarizeCalls(onChat)).toEqual([]);
	});

	it("reports a compaction the server refuses", async () => {
		const server = new FakeKiloServer();
		server.summarize = () =>
			new Response(JSON.stringify({ message: "The model is overloaded" }), {
				status: 500,
				headers: { "content-type": "application/json" },
			});
		await renderOnChat(server);
		await input().click();
		await userEvent.keyboard("/compact");
		await userEvent.keyboard("{Enter}");

		await expect.element(page.getByText("Couldn't compact the chat")).toBeVisible();
		await expect.element(page.getByText("The model is overloaded")).toBeVisible();
	});

	/**
	 * A pane on a chat with acme.tools' `wave` command placed in the `/` menu
	 * as `/wave`; `implement` binds the command, or leaves it unimplemented.
	 */
	async function renderWithWave(implement?: CommandHandler) {
		const server = new FakeKiloServer();
		server.addChat({ id: "ses_a", directory: "/projects/app", title: "Chat" });
		const host = await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
			plugins: [
				{
					manifest: {
						manifestVersion: 1,
						id: "acme.tools",
						displayName: "Acme tools",
						version: "1.0.0",
						requires: { "kilo.chat/client-slash-command": "optional" },
						contributes: {
							extensions: {
								"kernel/command": [{ id: "wave", title: "Wave at the agent", palette: false }],
								"kilo.chat/client-slash-command": [
									{ id: "wave", command: "acme.tools/wave", name: "wave" },
								],
							},
						},
					},
					web: {
						activate(sdk) {
							if (implement) sdk.extensions.implement(KernelCommand, "wave", implement);
						},
					},
				},
			],
		});
		await expect
			.poll(() => page.getByTestId("kilo-model-selector-trigger").element().textContent)
			.toContain("Fast One");
		return host;
	}

	it("runs another plugin's placed command with the composer's context", async () => {
		const run = vi.fn<(context: ClientSlashCommandContext) => void>();
		const host = await renderWithWave(slashCommandHandler(run));

		await input().click();
		await userEvent.keyboard("/wave");
		await page.getByText("Wave at the agent").click();

		await expect.poll(() => run.mock.calls.length).toBe(1);
		expect(run.mock.calls[0]![0]).toMatchObject({
			workSessionId: "wses_1",
			chatId: "ses_a",
			directory: "/projects/app",
			selection: { agent: "code", model: { providerID: "acme", modelID: "fast-1" } },
			running: false,
		});
		await expect.element(input()).toHaveTextContent("");
		expect(host.server.requestsTo("POST", "/session/ses_a/command")).toEqual([]);
	});

	it("leaves out a placement whose command isn't available, sending /name as a prompt", async () => {
		const host = await renderWithWave();

		await input().click();
		await userEvent.keyboard("/wave");
		await expect.element(page.getByText("Wave at the agent")).not.toBeInTheDocument();

		await userEvent.keyboard(" hello");
		await userEvent.keyboard("{Enter}");
		await expect.poll(() => promptBody(host, "ses_a")).toBeDefined();
		expect(JSON.stringify(promptBody(host, "ses_a"))).toContain("/wave hello");
	});

	it("reports a placed command that fails", async () => {
		await renderWithWave(() => Promise.reject(new Error("No hands")));

		await input().click();
		await userEvent.keyboard("/wave");
		await userEvent.keyboard("{Enter}");

		await expect.element(page.getByText("/wave failed")).toBeVisible();
		await expect.element(page.getByText("No hands")).toBeVisible();
	});
});

describe("the composer-mention point", () => {
	it("lists a source's items after its trigger and resolves the chosen one when sending", async () => {
		const search = vi.fn(async (query: string, context: { directory: string | null }) => [
			{ id: "n1", label: "Release notes", detail: `${context.directory} ${query}` },
		]);
		const resolve = vi.fn(async (item: { id: string; label: string }) => ({
			text: `[note ${item.id}]`,
			files: [{ url: "file:///notes/n1.md", mime: "text/markdown", filename: "n1.md" }],
		}));
		const host = await renderChat({
			plugins: [
				contributor(
					{ "kilo.chat/composer-mention": [{ id: "notes", trigger: "#", title: "Notes" }] },
					{
						activate(sdk) {
							sdk.extensions.implement(ComposerMention, "notes", {
								search,
								resolve,
								icon: FileTextIcon,
							});
						},
					},
				),
			],
		});
		await expect.element(input()).toHaveAttribute("aria-label", "Message input");
		await expect
			.element(page.getByText("Send a message, # to mention notes, or / for commands…"))
			.toBeInTheDocument();

		await input().click();
		await userEvent.keyboard("See #");
		await page.getByText("Release notes").click();
		await sendButton().click();

		await expect
			.poll(() => promptBody(host, "ses_new_1")?.parts)
			.toEqual([
				expect.objectContaining({ type: "text", text: expect.stringContaining("See [note n1]") }),
				{ type: "file", url: "file:///notes/n1.md", mime: "text/markdown", filename: "n1.md" },
			]);
		expect(search.mock.calls[0]![1]).toMatchObject({ directory: "/projects/app" });
	});
});

describe("the composer-action point", () => {
	it("draws contributed buttons, menus and command actions in their slots", async () => {
		const run = vi.fn();
		const select = vi.fn();
		const command = vi.fn();
		const seen: ComposerContext[] = [];
		const server = new FakeKiloServer();
		server.addChat({ id: "ses_a", directory: "/projects/app", title: "Chat" });
		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
			plugins: [
				contributor(
					{
						"kilo.chat/composer-action": [
							{ id: "sparkle", slot: "toolbar", kind: "action", title: "Sparkle" },
							{ id: "branch", slot: "footer", kind: "menu", title: "Branch" },
							{ id: "where", slot: "footer", kind: "view", title: "Where" },
							{
								id: "palette",
								slot: "toolbar-end",
								kind: "action",
								title: "Palette",
								command: "acme.tools/palette",
							},
							{ id: "hidden", slot: "toolbar", kind: "action", title: "Hidden" },
						],
						"kernel/command": [{ id: "palette", title: "Palette" }],
					},
					{
						activate(sdk) {
							sdk.extensions.implement(ComposerAction, "sparkle", {
								kind: "action",
								useButton: (context) => {
									seen.push(context);
									return { icon: SparklesIcon, label: "Sparkle", run };
								},
							});
							sdk.extensions.implement(ComposerAction, "branch", {
								kind: "menu",
								useMenu: () => ({
									label: "main",
									icon: GitBranchIcon,
									value: "main",
									items: [
										{ id: "main", label: "main" },
										{ id: "feature", label: "feature", description: "2 ahead" },
									],
									select,
								}),
							});
							sdk.extensions.implement(ComposerAction, "hidden", {
								kind: "action",
								useButton: () => ({ hidden: true }),
							});
							sdk.extensions.implement(ComposerAction, "where", {
								kind: "view",
								Component: ({ directory }) => <span data-qa-id="footer-where">{directory}</span>,
							});
							sdk.extensions.implement(KernelCommand, "palette", command);
						},
					},
				),
			],
		});

		await page.getByTestId("kilo-composer-action-sparkle").click();
		expect(run).toHaveBeenCalledOnce();
		expect(seen.at(-1)).toMatchObject({
			workSessionId: "wses_1",
			chatId: "ses_a",
			directory: "/projects/app",
			workspaceId: "w-app",
			workspaceFolders: [
				{ path: "/projects/app", isPrimary: true },
				{ path: "/projects/lib", isPrimary: false },
			],
		});
		await expect.element(page.getByTestId("kilo-composer-action-hidden")).not.toBeInTheDocument();

		await expect.element(page.getByTestId("footer-where").getByText("/projects/app")).toBeVisible();
		await page.getByTestId("kilo-branch-selector-trigger").click();
		await page.getByTestId("kilo-branch-selector-item-feature").click();
		expect(select).toHaveBeenCalledWith("feature");

		await page.getByTestId("kilo-composer-action-palette").click();
		await expect.poll(() => command.mock.calls.length).toBe(1);
	});

	it("opens a contributed popover and skips an action implemented as another kind", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await renderChat({
			plugins: [
				contributor(
					{
						"kilo.chat/composer-action": [
							{ id: "palette", slot: "toolbar-end", kind: "popover", title: "Palette" },
							{ id: "wrong", slot: "toolbar", kind: "menu", title: "Wrong" },
						],
					},
					{
						activate(sdk) {
							sdk.extensions.implement(ComposerAction, "palette", {
								kind: "popover",
								useTrigger: () => ({ label: "Colours", color: "#8b5cf6" }),
								Content: ({ open, close }) =>
									open ? (
										<div data-qa-id="palette-content">
											<button type="button" onClick={close}>
												Done
											</button>
										</div>
									) : null,
							});
							sdk.extensions.implement(ComposerAction, "wrong", {
								kind: "action",
								run: () => undefined,
							});
						},
					},
				),
			],
		});

		const trigger = page.getByTestId("kilo-palette-selector-trigger");
		await expect.element(trigger).toHaveTextContent("Colours");
		await trigger.click();
		await page.getByText("Done").click();
		await expect.element(page.getByTestId("palette-content")).not.toBeInTheDocument();
		await trigger
			.element()
			.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		await expect.element(page.getByTestId("palette-content")).toBeInTheDocument();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("acme.tools/wrong"));
		await expect.element(page.getByTestId("kilo-wrong-selector-trigger")).not.toBeInTheDocument();
	});

	it("shows the New Session page's draft footer only when something is contributed to it", async () => {
		await renderChat({
			starter: {},
			plugins: [
				contributor(
					{
						"kilo.chat/composer-action": [
							{ id: "worktree", slot: "draft-footer", kind: "action", title: "Worktree" },
						],
					},
					{
						activate(sdk) {
							sdk.extensions.implement(ComposerAction, "worktree", {
								kind: "action",
								useButton: () => ({ label: "Local", run: () => undefined }),
							});
						},
					},
				),
			],
		});
		await expect.element(page.getByTestId("kilo-composer-draft-footer")).toBeVisible();
		await expect
			.element(page.getByTestId("kilo-composer-action-worktree"))
			.toHaveTextContent("Local");
	});
});

const drafts = (host: Awaited<ReturnType<typeof renderChat>>) =>
	host.host.main.kernelSdk.domainObjects.get(Drafts)!;

describe("the composer domain object", () => {
	it("inserts text into a work session's composer and focuses it", async () => {
		const host = await renderChat();
		const composer = host.host.renderer.kernelSdk.domainObjects.get(Composer)!;
		await expect.element(input()).toBeVisible();

		await composer.methods.insert({ text: "Look at this" });
		await expect.element(input()).toHaveTextContent("Look at this");
		await expect.element(input()).toHaveFocus();
		await expect
			.poll(() => drafts(host).getState().drafts.wses_1?.panes?.pane_agent)
			.toBe("Look at this");
		await expect.poll(() => composer.getState().focusedWorkSessionId).toBe("wses_1");

		await composer.methods.insert({ workSessionId: "wses_1", text: "too" });
		await expect.element(input()).toHaveTextContent("Look at this too");
	});

	it("starts a new chat in a new work session with an Agent pane and the text unsent", async () => {
		const host = await renderChat();
		const composer = host.host.renderer.kernelSdk.domainObjects.get(Composer)!;

		const { workSessionId } = await composer.methods.startChat({
			text: "Install this skill",
			workspaceId: null,
		});

		expect(host.workSessions.calls.create).toHaveBeenCalledWith({ workspaceId: null });
		expect(host.navigatorOpened).toHaveBeenCalledWith(workSessionId);
		expect(host.workSessions.calls.open).toHaveBeenCalledWith(
			expect.objectContaining({ workSessionId, kind: "kilo.chat/agent" }),
		);
		await expect
			.poll(() => drafts(host).getState().drafts[workSessionId])
			.toEqual({ text: "Install this skill" });
	});

	it("starts a new chat in the active workspace by default", async () => {
		const host = await renderChat();
		const composer = host.host.renderer.kernelSdk.domainObjects.get(Composer)!;

		await composer.methods.startChat({ text: "Hi" });
		expect(host.workSessions.calls.create).toHaveBeenCalledWith({ workspaceId: "w-app" });
	});
});

describe("a kept work session's composer", () => {
	/** The composer on screen; kept work sessions leave theirs hidden. */
	const shownInputElement = () =>
		[...document.querySelectorAll<HTMLElement>('[data-qa-id="kilo-composer-input"]')].find(
			(element) => element.checkVisibility(),
		);
	const shownInput = () => {
		const shown = shownInputElement();
		if (!shown) throw new Error("No composer is shown");
		return page.elementLocator(shown);
	};

	/** Opens work session "wses_a", leaves it for "wses_b" and changes back to it. */
	async function leaveAndReturn(prepare?: () => Promise<void>) {
		const host = await renderChat({
			workSessionsWeb: testWebEntry,
			workSession: workSession({ id: "wses_a", title: "First" }),
			otherWorkSessions: [workSession({ id: "wses_b", title: "Second" })],
			pane: agentPane({ id: "pane_a" }),
			otherSessionPanes: {
				wses_b: {
					...EMPTY_WORK_SESSION_PANES,
					panes: [agentPane({ id: "pane_b" })],
					activePaneId: "pane_b",
				},
			},
		});
		const window = host.host.renderer.kernelSdk.domainObjects.get(WorkSessionsWindow)!;
		await expect.poll(shownInputElement).toBeTruthy();
		const shownCanvas = () => shownInputElement()?.closest('[data-qa-id="session-canvas"]');
		const canvasA = shownCanvas();
		await prepare?.();

		await window.methods.openWorkSession({ workSessionId: "wses_b" });
		await expect.poll(() => shownCanvas() !== canvasA && shownCanvas()).toBeTruthy();
		await window.methods.openWorkSession({ workSessionId: "wses_a" });
		await expect.poll(shownCanvas).toBe(canvasA);
	}

	it("takes typing in an empty composer after its work session is changed back to", async () => {
		await leaveAndReturn();

		await userEvent.click(shownInput());
		await userEvent.keyboard("Hello");
		await expect.element(shownInput()).toHaveTextContent("Hello");
	});

	it("keeps a draft, still editable, after its work session is changed back to", async () => {
		await leaveAndReturn(async () => {
			await userEvent.type(shownInput(), "Before");
			await expect.element(shownInput()).toHaveTextContent("Before");
		});

		await expect.element(shownInput()).toHaveTextContent("Before");
		await userEvent.click(shownInput());
		await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}After");
		await expect.element(shownInput()).toHaveTextContent("After");
	});
});
