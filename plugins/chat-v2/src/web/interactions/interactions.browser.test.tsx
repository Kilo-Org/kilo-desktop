import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { z } from "zod";

import type { PluginEntry } from "@kilo-desktop/kernel";
import { defineTool, Tool, toolWireName } from "@kilo-desktop/plugin-core/contracts";
import { PermissionAutoAnswer } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	AutoApprove,
	chatPaneObject,
	PermissionRenderer,
	type PermissionDetailProps,
} from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import {
	assistantMessage,
	FakeKiloServer,
	nextCreated,
	textContent,
	userMessage,
	type FakeMessage,
} from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

const QUESTION = "What does login do?";
const INSTALL_TOOL = "acme.tools/install";

const reply = textContent;

function chatWith(content: Record<string, unknown>[]): FakeMessage[] {
	return [userMessage("msg_1", QUESTION), assistantMessage("msg_2", content)];
}

/** A tool call Kilo is still running (`toolContent` builds finished ones). */
function runningTool(id: string, name: string, input: Record<string, unknown>) {
	const created = nextCreated();
	return {
		type: "tool",
		id,
		name,
		executed: false,
		state: { status: "running", input },
		time: { created, ran: created },
	};
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
			requires: {
				"kilo.chat/permission-renderer": "optional",
				"kilo.core/tool": "optional",
			},
			contributes: { extensions },
		},
		...entries,
	};
}

async function liveChat() {
	const host = await showChat(chatWith([reply("Ready.")]));
	await vi.waitFor(() => expect(host.server.openStreams).toBe(1));
	return host;
}

describe("permission requests", () => {
	it("replace the composer with a permission card until the person answers", async () => {
		const host = await liveChat();

		host.server.askPermission("ses_a", {
			id: "per_1",
			action: "shell",
			resources: ["rm -rf build", "*"],
			save: ["rm *"],
			message: "Clean the build",
		});

		await expect.element(page.getByTestId("kilo-permission-card")).toBeVisible();
		await expect.element(page.getByText("rm -rf build")).toBeVisible();
		await expect.element(page.getByText("Clean the build")).toBeVisible();
		await expect.element(page.getByTestId("kilo-composer-input")).not.toBeInTheDocument();
		await page.getByTestId("kilo-permission-always").click();

		await expect
			.poll(
				() => host.server.requestsTo("POST", "/api/session/ses_a/permission/per_1/reply")[0]?.body,
			)
			.toMatchObject({ decision: "always" });
		expect(host.agent.calls.replyPermission).toHaveBeenCalledWith({
			chatId: "ses_a",
			permissionId: "per_1",
			reply: "always",
			interactive: true,
		});
		// The server announces the reply on the stream (`permission.replied`), which the transcript follows.
		await expect.element(page.getByTestId("kilo-permission-card")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("kilo-composer-input")).toBeInTheDocument();
	});

	describe("asked while the chat wasn't open", () => {
		async function openAfter(ask: (server: FakeKiloServer) => void) {
			const server = new FakeKiloServer();
			server.addChat({
				id: "ses_a",
				directory: "/projects/app",
				title: "Chat",
				messages: chatWith([reply("Ready.")]),
			});
			ask(server);
			return renderChat({
				server,
				pane: agentPane({ object: chatPaneObject("ses_a") }),
				chats: [chatSummary("ses_a")],
			});
		}

		it("shows the waiting permission card once the chat opens", async () => {
			// Asked before any window listens, so only the server's pending list has it.
			const host = await openAfter((server) =>
				server.askPermission("ses_a", {
					id: "per_away",
					action: "shell",
					resources: ["git grep maxBytes"],
				}),
			);

			await expect.element(page.getByTestId("kilo-permission-card")).toBeVisible();
			await expect.element(page.getByText("git grep maxBytes")).toBeVisible();
			await page.getByTestId("kilo-permission-once").click();
			await expect
				.poll(
					() =>
						host.server.requestsTo("POST", "/api/session/ses_a/permission/per_away/reply")[0]?.body,
				)
				.toMatchObject({ decision: "once" });
		});

		it("shows the waiting question once the chat opens", async () => {
			await openAfter((server) =>
				server.askQuestion("ses_a", {
					id: "que_away",
					questions: [
						{
							question: "Which branch should I review?",
							header: "Branch",
							options: [{ label: "main", description: "The default branch" }],
						},
					],
				}),
			);

			await expect.element(page.getByText("Which branch should I review?")).toBeVisible();
		});

		it("leaves another chat's prompts to that chat", async () => {
			await openAfter((server) => {
				// In the same directory, so the server lists it alongside this chat's.
				server.addChat({ id: "ses_other", directory: "/projects/app", title: "Other" });
				server.askPermission("ses_other", { id: "per_other", action: "shell", resources: ["ls"] });
			});

			await expect.element(page.getByTestId("kilo-composer-input")).toBeInTheDocument();
			await expect.element(page.getByTestId("kilo-permission-card")).not.toBeInTheDocument();
		});
	});

	it("accepts once on Enter, and says why a reply failed", async () => {
		const host = await liveChat();
		host.server.failingReplies.add("per_3");

		host.server.askPermission("ses_a", { id: "per_3", action: "shell", resources: ["ls"] });
		await expect.element(page.getByTestId("kilo-permission-card")).toBeVisible();
		(document.activeElement as HTMLElement | null)?.blur();
		document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

		await expect
			.poll(
				() => host.server.requestsTo("POST", "/api/session/ses_a/permission/per_3/reply")[0]?.body,
			)
			.toMatchObject({ decision: "once" });
		await expect.element(page.getByText("The operation failed.").first()).toBeVisible();
		await expect.element(page.getByTestId("kilo-permission-card")).toBeVisible();
	});

	it("stay hidden while Auto answers them, and show the ones that need the person", async () => {
		const host = await liveChat();
		await host.host.renderer
			.sdkFor("kilo.chat")
			.domainObjects.get(AutoApprove)!
			.methods.setMode({ mode: "auto" });

		host.server.askPermission("ses_a", { id: "per_auto", action: "shell", resources: ["ls"] });
		await expect
			.poll(() => host.agent.calls.replyPermission.mock.calls.map(([input]) => input))
			.toContainEqual(expect.objectContaining({ permissionId: "per_auto", reply: "once" }));
		await expect.element(page.getByTestId("kilo-permission-card")).not.toBeInTheDocument();

		host.server.askPermission("ses_a", {
			id: "per_escalate",
			action: "shell",
			resources: ["sudo ls"],
			metadata: { sandboxEscalation: true },
		});
		await expect.element(page.getByText("sudo ls")).toBeVisible();
	});

	it("tell the notifier which ones Auto answers, so only the rest sound", async () => {
		const host = await liveChat();
		const answeredForPerson = (metadata: Record<string, unknown> = {}) =>
			host.host.renderer.extensions.list(PermissionAutoAnswer).some((contribution) =>
				contribution.implementation?.({
					id: "per_1",
					chatId: "ses_a",
					permission: "external_directory",
					patterns: ["/tmp/*"],
					metadata,
				}),
			);
		expect(answeredForPerson()).toBe(false);

		await host.host.renderer
			.sdkFor("kilo.chat")
			.domainObjects.get(AutoApprove)!
			.methods.setMode({ mode: "auto" });

		await expect.poll(() => answeredForPerson()).toBe(true);
		expect(answeredForPerson({ sandboxEscalation: true })).toBe(false);
	});

	it("offers only Allow once when Kilo has nothing to remember", async () => {
		const host = await liveChat();

		host.server.askPermission("ses_a", { id: "per_2", action: "edit" });

		await expect.element(page.getByTestId("kilo-permission-once")).toBeVisible();
		await expect.element(page.getByTestId("kilo-permission-always")).not.toBeInTheDocument();
		await page.getByTestId("kilo-permission-reject").click();
		await expect
			.poll(
				() => host.server.requestsTo("POST", "/api/session/ses_a/permission/per_2/reply")[0]?.body,
			)
			.toMatchObject({ decision: "reject" });
	});

	it("show what permission renderers for the requesting tool add, matched on its contribution key", async () => {
		const seen: PermissionDetailProps["request"][] = [];
		const InstallDetail = ({ request }: PermissionDetailProps) => {
			seen.push(request);
			const packages = (request.args as { packages?: string[] } | undefined)?.packages ?? [];
			return <p data-qa-id="acme-install-detail">Packages: {packages.join(", ")}</p>;
		};
		const wireName = toolWireName(INSTALL_TOOL);
		const host = await showChat(
			chatWith([runningTool("call_install", wireName, { packages: ["numpy"] })]),
			{
				plugins: [
					contributor(
						{
							"kilo.core/tool": [{ id: "install", title: "Install packages" }],
							"kilo.chat/permission-renderer": [
								{ id: "install", tools: [INSTALL_TOOL] },
								{ id: "elsewhere", tools: ["acme.tools/other"] },
							],
						},
						{
							main: {
								activate(sdk) {
									sdk.extensions.implement(
										Tool,
										"install",
										defineTool({
											description: "Installs packages.",
											input: z.object({ packages: z.array(z.string()) }),
											run: () => "Installed.",
										}),
									);
								},
							},
							web: {
								activate(sdk) {
									sdk.extensions.implement(PermissionRenderer, "install", {
										permissionTitle: () => "installing packages",
										PermissionDetail: InstallDetail,
										allowAlways: () => false,
									});
									sdk.extensions.implement(PermissionRenderer, "elsewhere", {
										permissionTitle: () => "running a command",
									});
								},
							},
						},
					),
				],
			},
		);
		await vi.waitFor(() => expect(host.server.openStreams).toBe(1));

		host.server.askPermission("ses_a", {
			id: "per_install",
			action: wireName,
			resources: ["*"],
			save: ["*"],
			metadata: { channel: "conda-forge" },
			source: { type: "tool", messageID: "msg_2", id: "call_install" },
		});

		const card = page.getByTestId("kilo-permission-card");
		await expect.element(card.getByText("Allow installing packages?")).toBeVisible();
		await expect
			.poll(
				() =>
					[...document.querySelectorAll('[data-qa-id="acme-install-detail"]')].map(
						(element) => element.textContent,
					),
				{ timeout: 10_000 },
			)
			.toContain("Packages: numpy");
		await expect.element(page.getByTestId("kilo-permission-once")).toBeVisible();
		await expect.element(page.getByTestId("kilo-permission-always")).not.toBeInTheDocument();
		expect(seen.at(-1)).toEqual({
			permission: wireName,
			toolKey: INSTALL_TOOL,
			patterns: [],
			metadata: { channel: "conda-forge" },
			args: { packages: ["numpy"] },
		});
	});

	it("show what permission renderers for a Kilo permission add, matched on its name", async () => {
		const host = await showChat(chatWith([reply("Ready.")]), {
			plugins: [
				contributor(
					{ "kilo.chat/permission-renderer": [{ id: "run", permissions: ["acme_execute"] }] },
					{
						web: {
							activate(sdk) {
								sdk.extensions.implement(PermissionRenderer, "run", {
									permissionTitle: () => "Run code",
									PermissionDetail: ({ request }: PermissionDetailProps) => (
										<p data-qa-id="acme-run-detail">{request.permission}</p>
									),
								});
							},
						},
					},
				),
			],
		});
		await vi.waitFor(() => expect(host.server.openStreams).toBe(1));

		host.server.askPermission("ses_a", {
			id: "per_run",
			action: "acme_execute",
			resources: ["notebook-1"],
			metadata: { input: { cell: 1 } },
		});

		const card = page.getByTestId("kilo-permission-card");
		await expect.element(card.getByText("Allow Run code?", { exact: true })).toBeVisible();
		await expect.element(page.getByTestId("acme-run-detail")).toHaveTextContent("acme_execute");
	});

	it("hide the request's patterns when a renderer summarizes its metadata instead", async () => {
		const host = await showChat(chatWith([reply("Ready.")]), {
			plugins: [
				contributor(
					{ "kilo.chat/permission-renderer": [{ id: "run", permissions: ["acme_execute"] }] },
					{
						web: {
							activate(sdk) {
								sdk.extensions.implement(PermissionRenderer, "run", {
									showPatterns: () => false,
									PermissionDetail: ({ request }: PermissionDetailProps) => (
										<p data-qa-id="acme-run-detail">{String(request.metadata["notebook"])}</p>
									),
								});
							},
						},
					},
				),
			],
		});
		await vi.waitFor(() => expect(host.server.openStreams).toBe(1));

		host.server.askPermission("ses_a", {
			id: "per_run",
			action: "acme_execute",
			resources: ["notebook-1"],
			save: ["notebook-1"],
			metadata: { notebook: "analysis.ipynb" },
		});

		const card = page.getByTestId("kilo-permission-card");
		await expect.element(page.getByTestId("acme-run-detail")).toHaveTextContent("analysis.ipynb");
		await expect.element(card.getByText("notebook-1")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("kilo-permission-always")).toBeVisible();
	});
});

describe("agent questions", () => {
	it("warn under a question's answers that a renderer flags", async () => {
		const host = await showChat(chatWith([reply("Ready.")]), {
			plugins: [
				contributor(
					{ "kilo.chat/permission-renderer": [{ id: "guard" }] },
					{
						web: {
							activate(sdk) {
								sdk.extensions.implement(PermissionRenderer, "guard", {
									optionWarning: (option) =>
										option.description?.includes("local file") ? "Risky." : undefined,
								});
							},
						},
					},
				),
			],
		});
		await vi.waitFor(() => expect(host.server.openStreams).toBe(1));

		host.server.askQuestion("ses_a", {
			id: "que_guard",
			questions: [
				{
					question: "How should I install it?",
					header: "Install",
					options: [
						{ label: "From a channel", description: "conda-forge" },
						{ label: "From disk", description: "Install the local file" },
					],
				},
			],
		});

		await expect.element(page.getByText("How should I install it?")).toBeVisible();
		await expect.element(page.getByText("Risky.")).toBeVisible();
		expect(document.querySelectorAll('[data-slot="questionnaire-choice-warning"]')).toHaveLength(1);
	});

	it("are asked in place of the composer and answered through kilo.core", async () => {
		const host = await liveChat();

		host.server.askQuestion("ses_a", {
			id: "que_1",
			questions: [
				{
					question: "Which environment?",
					header: "Environment",
					options: [{ label: "Development", description: "Local services" }, { label: "Staging" }],
				},
			],
		});

		await expect.element(page.getByText("Which environment?")).toBeVisible();
		document.querySelector<HTMLInputElement>('input[value="Development"]')!.click();
		await page.getByRole("button", { name: "Submit" }).click();

		await expect
			.poll(() => host.server.requestsTo("POST", "/api/session/ses_a/form/que_1/reply")[0]?.body)
			.toEqual({ answer: { q0: "Development" } });
		expect(host.agent.calls.replyQuestion).toHaveBeenCalledWith({
			chatId: "ses_a",
			questionId: "que_1",
			answers: [["Development"]],
		});
		// The server announces the answer on the stream (`form.replied`), which the transcript follows.
		await expect.element(page.getByTestId("kilo-composer-input")).toBeInTheDocument();
	});

	it("take a typed answer when the question allows one", async () => {
		const host = await liveChat();

		host.server.askQuestion("ses_a", {
			id: "que_3",
			questions: [
				{
					question: "Which branch?",
					header: "Branch",
					options: [{ label: "main" }],
				},
			],
		});

		await expect.element(page.getByText("Which branch?")).toBeVisible();
		const custom = page.getByRole("textbox").last();
		await custom.fill("release");
		await page.getByRole("button", { name: "Submit" }).click();
		await expect
			.poll(() => host.server.requestsTo("POST", "/api/session/ses_a/form/que_3/reply")[0]?.body)
			.toEqual({ answer: { q0: "release" } });
	});

	it("can be dismissed, and say why a reply failed", async () => {
		const host = await liveChat();
		host.server.failingReplies.add("que_2");

		host.server.askQuestion("ses_a", {
			id: "que_2",
			questions: [{ question: "Go on?", header: "Go", options: [{ label: "Yes" }] }],
		});

		await page.getByRole("button", { name: "Dismiss" }).click();
		await expect
			.poll(() => host.server.requestsTo("DELETE", "/api/session/ses_a/form/que_2").length)
			.toBe(1);
		expect(host.agent.calls.rejectQuestion).toHaveBeenCalledWith({
			chatId: "ses_a",
			questionId: "que_2",
		});
		await expect.element(page.getByText("The operation failed.").first()).toBeVisible();
		await expect.element(page.getByText("Go on?")).toBeVisible();
	});
});
