import { FileTextIcon, GitBranchIcon, SparklesIcon } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelCommand, type PluginEntry } from "@kilo-desktop/kernel";

import {
	AutoApprove,
	Composer,
	ComposerAction,
	ComposerDrafts,
	ComposerMention,
	ModelPreferences,
	type ComposerContext,
} from "../../contracts";
import { agentPane, chatSummary, renderAgentPane } from "../../test/chat-host";
import { FakeKiloServer } from "../../test/fake-kilo-server";

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

function promptBody(host: Awaited<ReturnType<typeof renderAgentPane>>, chatId: string) {
	return host.server.requestsTo("POST", `/session/${chatId}/prompt_async`).at(-1)?.body as
		| Record<string, unknown>
		| undefined;
}

describe("the composer's pickers", () => {
	it("sends with the picked agent and model, and remembers a draft's model for new chats", async () => {
		const host = await renderAgentPane();
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
		const preferences = host.host.main.kernelSdk.domains.get(ModelPreferences)!;
		expect(preferences.getState().modelSelections.plan).toEqual({
			providerID: "acme",
			modelID: "deep-2",
		});
	});

	it("cycles the agent with Shift+Tab", async () => {
		await renderAgentPane();
		const agent = page.getByTestId("kilo-agent-selector-trigger");
		await expect.element(agent).toHaveTextContent("Code");

		await input().click();
		await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
		await expect.element(agent).toHaveTextContent("Plan");
	});

	it("shows the agent Kilo recorded for a chat the pane opens", async () => {
		const server = new FakeKiloServer();
		server.addChat({ id: "ses_a", directory: "/projects/app", title: "Chat", agent: "plan" });
		await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
		});

		await expect.element(page.getByTestId("kilo-agent-selector-trigger")).toHaveTextContent("Plan");
	});

	it("lists a provider added since the catalog was read when the model picker opens", async () => {
		const server = new FakeKiloServer();
		await renderAgentPane({ server });
		const model = page.getByTestId("kilo-model-selector-trigger");
		await expect.poll(() => model.element().textContent).toContain("Fast One");

		const providers = server.providers as { all: unknown[]; connected: string[] };
		server.providers = {
			...providers,
			all: [
				...providers.all,
				{ id: "stub", name: "Stub", models: { m1: { id: "m1", name: "Stub One", variants: {} } } },
			],
			connected: [...providers.connected, "stub"],
		};
		await model.click();

		await expect.element(page.getByTestId("kilo-model-selector-rail-stub")).toBeVisible();
	});

	it("switches the approval mode for every chat", async () => {
		const host = await renderAgentPane();
		await page.getByTestId("kilo-approval-selector-trigger").click();
		await page.getByTestId("kilo-approval-selector-item-auto").click();

		const autoApprove = host.host.main.kernelSdk.domains.get(AutoApprove)!;
		await expect.poll(() => autoApprove.getState().mode).toBe("auto");
	});
});

describe("slash commands", () => {
	it("runs a known /command through the chat's command call", async () => {
		const host = await renderAgentPane();
		await expect.element(page.getByTestId("kilo-agent-selector-trigger")).toBeVisible();

		await userEvent.fill(input(), "/review the diff");
		await sendButton().click();

		await expect
			.poll(() => host.server.requestsTo("POST", "/session/ses_new_1/command").at(-1)?.body)
			.toMatchObject({ command: "review", arguments: "the diff", agent: "code" });
		expect(host.server.requestsTo("POST", "/session/ses_new_1/prompt_async")).toEqual([]);
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
		const host = await renderAgentPane({
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
		await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
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
			sessionId: "wses_1",
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
		await renderAgentPane({
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

	it("shows the draft footer only when something is contributed to it", async () => {
		await renderAgentPane({
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

const drafts = (host: Awaited<ReturnType<typeof renderAgentPane>>) =>
	host.host.main.kernelSdk.domains.get(ComposerDrafts)!;

describe("the composer domain object", () => {
	it("inserts text into a session's composer and focuses it", async () => {
		const host = await renderAgentPane();
		const composer = host.host.renderer.kernelSdk.domains.get(Composer)!;
		await expect.element(input()).toBeVisible();

		await composer.methods.insert({ text: "Look at this" });
		await expect.element(input()).toHaveTextContent("Look at this");
		await expect.element(input()).toHaveFocus();
		await expect.poll(() => drafts(host).getState().drafts.wses_1?.text).toBe("Look at this");
		await expect.poll(() => composer.getState().focusedSessionId).toBe("wses_1");

		await composer.methods.insert({ sessionId: "wses_1", text: "too" });
		await expect.element(input()).toHaveTextContent("Look at this too");
	});

	it("starts a new chat in a new Agent session with the text unsent", async () => {
		const host = await renderAgentPane();
		const composer = host.host.renderer.kernelSdk.domains.get(Composer)!;

		const { sessionId } = await composer.methods.startNewChat({
			text: "Install this skill",
			workspaceId: null,
		});

		expect(host.sessions.calls.create).toHaveBeenCalledWith({ workspaceId: null });
		expect(host.navigatorOpened).toHaveBeenCalledWith(sessionId);
		expect(host.sessions.calls.open).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId, kind: "kilo.chat/agent" }),
		);
		await expect
			.poll(() => drafts(host).getState().drafts[sessionId])
			.toEqual({ text: "Install this skill" });
	});

	it("starts a new chat in the active workspace by default", async () => {
		const host = await renderAgentPane();
		const composer = host.host.renderer.kernelSdk.domains.get(Composer)!;

		await composer.methods.startNewChat({ text: "Hi" });
		expect(host.sessions.calls.create).toHaveBeenCalledWith({ workspaceId: "w-app" });
	});
});
