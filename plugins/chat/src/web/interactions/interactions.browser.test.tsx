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
import type {
	FormInfo,
	SessionMessageAssistant,
	SessionMessageInfo,
} from "@kilo-desktop/react-opencode";

import { agentPane, chatSummary } from "../../test/chat-host";
import { FakeKilo2Server } from "../../test/kilo2/fake-kilo2-server";
import {
	assistantMessage,
	questionForm,
	session,
	text,
	tool,
	userMessage,
} from "../../test/kilo2/fixtures";
import { renderChat } from "../../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

const QUESTION = "What does login do?";
const INSTALL_TOOL = "acme.tools/install";

function chatWith(content: SessionMessageAssistant["content"]): SessionMessageInfo[] {
	return [userMessage(QUESTION, { id: "msg_1" }), assistantMessage(content, { id: "msg_2" })];
}

const permissionReplies = (server: FakeKilo2Server, id: string) =>
	server.requestsTo("POST", `/api/session/ses_a/permission/${id}/reply`).map(({ body }) => body);

const formReplies = (server: FakeKilo2Server, id: string) =>
	server.requestsTo("POST", `/api/session/ses_a/form/${id}/reply`).map(({ body }) => body);

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
	const host = await showChat(chatWith([text("Ready.")]));
	await vi.waitFor(() => expect(host.server.openStreams).toBe(1));
	return host;
}

describe("permission requests", () => {
	it("replace the composer with a permission card until the person answers", async () => {
		const host = await liveChat();

		const request = host.server.askPermission("ses_a", {
			action: "shell",
			resources: ["rm -rf build", "*"],
			save: ["rm *"],
			metadata: { description: "Clean the build" },
		});

		await expect.element(page.getByTestId("kilo-permission-card")).toBeVisible();
		await expect.element(page.getByText("rm -rf build")).toBeVisible();
		await expect.element(page.getByText("Clean the build")).toBeVisible();
		await expect.element(page.getByTestId("kilo-composer-input")).not.toBeInTheDocument();
		await page.getByTestId("kilo-permission-always").click();

		await expect
			.poll(() => permissionReplies(host.server, request.id)[0])
			.toMatchObject({ decision: "always" });
		expect(host.agent.calls.replyPermission).toHaveBeenCalledWith({
			chatId: "ses_a",
			permissionId: request.id,
			decision: "always",
		});
		// The server announces the reply on the stream, which the transcript follows.
		await expect.element(page.getByTestId("kilo-permission-card")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("kilo-composer-input")).toBeInTheDocument();
	});

	describe("asked while the chat wasn't open", () => {
		async function openAfter(ask: (server: FakeKilo2Server) => void) {
			const server = new FakeKilo2Server();
			server.addChat(session("ses_a", { title: "Chat" }), chatWith([text("Ready.")]));
			ask(server);
			return renderChat({
				server,
				pane: agentPane({ object: chatPaneObject("ses_a") }),
				chats: [chatSummary("ses_a")],
			});
		}

		it("shows the waiting permission card once the chat opens", async () => {
			const host = await openAfter((server) =>
				server.permissions.push({
					id: "per_away",
					sessionID: "ses_a",
					action: "shell",
					resources: ["git grep maxBytes"],
					metadata: {},
				}),
			);

			await expect.element(page.getByTestId("kilo-permission-card")).toBeVisible();
			await expect.element(page.getByText("git grep maxBytes")).toBeVisible();
			await page.getByTestId("kilo-permission-once").click();
			await expect
				.poll(() => permissionReplies(host.server, "per_away")[0])
				.toMatchObject({ decision: "once" });
		});

		it("shows the waiting question once the chat opens", async () => {
			await openAfter((server) =>
				server.forms.push(
					questionForm("ses_a", [
						{
							question: "Which branch should I review?",
							header: "Branch",
							options: [{ label: "main", description: "The default branch" }],
						},
					]),
				),
			);

			await expect.element(page.getByText("Which branch should I review?")).toBeVisible();
		});

		it("leaves another chat's prompts to that chat", async () => {
			await openAfter((server) =>
				server.permissions.push({
					id: "per_other",
					sessionID: "ses_other",
					action: "shell",
					resources: ["ls"],
					metadata: {},
				}),
			);

			await expect.element(page.getByTestId("kilo-composer-input")).toBeInTheDocument();
			await expect.element(page.getByTestId("kilo-permission-card")).not.toBeInTheDocument();
		});
	});

	it("accepts once on Enter, and says why a reply failed", async () => {
		const host = await liveChat();
		host.server.failing.add("POST /api/session/ses_a/permission/per_3/reply");

		host.server.askPermission("ses_a", { id: "per_3", action: "shell", resources: ["ls"] });
		await expect.element(page.getByTestId("kilo-permission-card")).toBeVisible();
		(document.activeElement as HTMLElement | null)?.blur();
		document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

		await expect
			.poll(() => permissionReplies(host.server, "per_3")[0])
			.toMatchObject({ decision: "once" });
		await expect
			.element(page.getByText(/Could not answer the permission request/).first())
			.toBeVisible();
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
			.toContainEqual(expect.objectContaining({ permissionId: "per_auto", decision: "once" }));
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
					action: "external_directory",
					resources: ["/tmp/*"],
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
			.poll(() => permissionReplies(host.server, "per_2")[0])
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
			chatWith([
				{
					...tool(wireName, {}, "", { id: "call_install" }),
					state: { status: "running", input: { packages: ["numpy"] }, metadata: {} },
				},
			]),
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
			action: wireName,
			toolKey: INSTALL_TOOL,
			resources: [],
			save: ["*"],
			metadata: { channel: "conda-forge" },
			args: { packages: ["numpy"] },
		});
	});

	it("show what permission renderers for a Kilo action add, matched on its name, not the card's label", async () => {
		const host = await showChat(chatWith([text("Ready.")]), {
			plugins: [
				contributor(
					{ "kilo.chat/permission-renderer": [{ id: "run", actions: ["acme_execute"] }] },
					{
						web: {
							activate(sdk) {
								sdk.extensions.implement(PermissionRenderer, "run", {
									PermissionDetail: ({ request }: PermissionDetailProps) => (
										<p data-qa-id="acme-run-detail">{request.action}</p>
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
			metadata: { toolName: "Run code" },
		});

		const card = page.getByTestId("kilo-permission-card");
		await expect.element(card.getByText("Run code", { exact: true })).toBeVisible();
		await expect.element(page.getByTestId("acme-run-detail")).toHaveTextContent("acme_execute");
	});

	it("hide the request's resources when a renderer summarizes its metadata instead", async () => {
		const host = await showChat(chatWith([text("Ready.")]), {
			plugins: [
				contributor(
					{ "kilo.chat/permission-renderer": [{ id: "run", actions: ["acme_execute"] }] },
					{
						web: {
							activate(sdk) {
								sdk.extensions.implement(PermissionRenderer, "run", {
									showResources: () => false,
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
			metadata: { toolName: "Run code", notebook: "analysis.ipynb" },
		});

		const card = page.getByTestId("kilo-permission-card");
		await expect.element(page.getByTestId("acme-run-detail")).toHaveTextContent("analysis.ipynb");
		await expect.element(card.getByText("notebook-1")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("kilo-permission-always")).toBeVisible();
	});
});

/** A question form whose questions take only the offered answers. */
const withoutCustomAnswers = (form: FormInfo): FormInfo => ({
	...form,
	fields: form.fields.map((field) => ({ ...field, custom: false })) as FormInfo["fields"],
});

describe("agent questions", () => {
	it("warn under a question's answers that a renderer flags", async () => {
		const host = await showChat(chatWith([text("Ready.")]), {
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

		host.server.createForm(
			withoutCustomAnswers(
				questionForm("ses_a", [
					{
						question: "How should I install it?",
						header: "Install",
						options: [
							{ label: "From a channel", description: "conda-forge" },
							{ label: "From disk", description: "Install the local file" },
						],
					},
				]),
			),
		);

		await expect.element(page.getByText("How should I install it?")).toBeVisible();
		await expect.element(page.getByText("Risky.")).toBeVisible();
		expect(document.querySelectorAll('[data-slot="questionnaire-choice-warning"]')).toHaveLength(1);
	});

	it("are asked in place of the composer and answered through kilo.core", async () => {
		const host = await liveChat();

		const form = host.server.createForm(
			withoutCustomAnswers(
				questionForm("ses_a", [
					{
						question: "Which environment?",
						header: "Environment",
						options: [{ label: "Development", description: "Local services" }, "Staging"],
					},
				]),
			),
		);

		await expect.element(page.getByText("Which environment?")).toBeVisible();
		document.querySelector<HTMLInputElement>('input[value="Development"]')!.click();
		await page.getByRole("button", { name: "Submit" }).click();

		await expect.poll(() => formReplies(host.server, form.id)[0]).toBeDefined();
		expect(host.agent.calls.replyQuestion).toHaveBeenCalledWith({
			chatId: "ses_a",
			questionId: form.id,
			answers: [["Development"]],
		});
		// The server announces the answer on the stream, which the transcript follows.
		await expect.element(page.getByTestId("kilo-composer-input")).toBeInTheDocument();
	});

	it("take a typed answer when the question allows one", async () => {
		const host = await liveChat();

		const form = host.server.createForm(
			questionForm("ses_a", [{ question: "Which branch?", header: "Branch", options: ["main"] }]),
		);

		await expect.element(page.getByText("Which branch?")).toBeVisible();
		const custom = page.getByRole("textbox").last();
		await custom.fill("release");
		await page.getByRole("button", { name: "Submit" }).click();
		await expect.poll(() => formReplies(host.server, form.id)[0]).toBeDefined();
		expect(host.agent.calls.replyQuestion).toHaveBeenCalledWith(
			expect.objectContaining({ questionId: form.id, answers: [["release"]] }),
		);
	});

	it("can be dismissed, and say why a reply failed", async () => {
		const host = await liveChat();
		const form = questionForm("ses_a", [{ question: "Go on?", header: "Go", options: ["Yes"] }]);
		host.server.failing.add(`DELETE /api/session/ses_a/form/${form.id}`);
		host.server.createForm(form);

		await page.getByRole("button", { name: "Dismiss" }).click();
		await expect
			.poll(() => host.server.requestsTo("DELETE", `/api/session/ses_a/form/${form.id}`).length)
			.toBe(1);
		expect(host.agent.calls.rejectQuestion).toHaveBeenCalledWith({
			chatId: "ses_a",
			questionId: form.id,
		});
		await expect.element(page.getByText(/Could not dismiss the question/).first()).toBeVisible();
		await expect.element(page.getByText("Go on?")).toBeVisible();
	});
});
