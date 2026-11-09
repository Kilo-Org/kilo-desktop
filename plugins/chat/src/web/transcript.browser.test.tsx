import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { PluginEntry } from "@kilo-desktop/kernel";
import {
	AgentTool,
	defineTool,
	SIGN_IN_DECLINED_TOOL_MESSAGE,
	signInRequiredToolMessage,
	toolWireName,
} from "@kilo-desktop/plugin-agent/contracts";
import { z } from "zod";

import {
	InteractionRenderer,
	MarkdownExtension,
	McpApp,
	ToolRenderer,
	type MarkdownExtensionImplementation,
	type PermissionDetailProps,
	type ToolRendererProps,
} from "../contracts";
import { agentPane, chatSummary, renderAgentPane } from "../test/chat-host";
import {
	assistantMessage,
	FakeKiloServer,
	userMessage,
	type FakeMessage,
} from "../test/fake-kilo-server";
import { SIGNED_IN, SIGNED_OUT } from "../test/kernel-harness";
import { EMPTY_KILO_CATALOG_RETRY_LIMIT } from "./runtime/kilo-connection-error";
import {
	button,
	expandAll,
	expandUntil,
	expectPresent,
	toolPart,
	turnWork,
} from "../test/transcript";

afterEach(() => {
	vi.unstubAllGlobals();
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
	options: Omit<Parameters<typeof renderAgentPane>[0] & object, "server"> = {},
) {
	const server = new FakeKiloServer();
	server.addChat({ id: "ses_a", directory: "/projects/app", title: "Chat", messages });
	const host = await renderAgentPane({
		server,
		pane: agentPane({ metadata: { chatId: "ses_a" } }),
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
			requires: { "kilo.chat/tool-renderer": "optional" },
			contributes: { extensions },
		},
		...entries,
	};
}

const reply = (text: string) => ({ type: "text", text, time: { start: 3, end: 4 } });

const promptsTo = (server: FakeKiloServer) =>
	server.requestsTo("POST", "/session/ses_a/prompt_async");

describe("kilo.chat's tool renderers", () => {
	it("shows a file edit's diff and counts", async () => {
		await showChat(
			chatWith([
				toolPart("edit", {
					input: { filePath: "/projects/app/login.ts", oldString: "a\n", newString: "b\nc\n" },
				}),
				reply("Edited."),
			]),
		);

		await expandUntil([turnWork, button(/login\.ts/)], () =>
			expect(page.getByText("login.ts").first().element()).toBeVisible(),
		);
		await expect.element(page.getByText("+2").first()).toBeInTheDocument();
	});

	it("shows a command and its output", async () => {
		await showChat(
			chatWith([
				toolPart("bash", {
					input: { command: "pnpm test", description: "Run the tests" },
					output: "12 passed",
					metadata: { output: "12 passed", exit: 0 },
				}),
				reply("Tests pass."),
			]),
		);

		await expandUntil([turnWork, button(/pnpm test|Run the tests/)], () =>
			expect(page.getByText("12 passed").element()).toBeVisible(),
		);
	});

	it("groups a turn's searches and web lookups", async () => {
		await showChat(
			chatWith([
				toolPart("grep", { input: { pattern: "login" }, output: "Found 2 matches" }, "c1"),
				toolPart("glob", { input: { pattern: "**/*.ts" }, output: "a.ts\nb.ts" }, "c2"),
				toolPart("webfetch", { input: { url: "https://example.com/docs" } }, "c3"),
				toolPart("websearch", { input: { query: "oauth" } }, "c4"),
				toolPart("skill", { input: { name: "tdd" } }, "c5"),
				reply("Found it."),
			]),
		);

		await expandUntil([turnWork], () =>
			expect(page.getByRole("button", { name: /tools used/ }).element()).toBeVisible(),
		);
	});

	it("lists a running turn's tasks over the composer", async () => {
		const host = await showChat(
			chatWith([
				toolPart("todowrite", {
					input: {
						todos: [
							{ content: "Write the tests", status: "completed" },
							{ content: "Port the cards", status: "in_progress" },
						],
					},
				}),
				reply("On it."),
			]),
		);
		await vi.waitFor(() => expect(host.server.openStreams).toBe(1));

		host.server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });

		await expect.element(page.getByText("Port the cards")).toBeInTheDocument();
		host.server.emit("session.idle", { sessionID: "ses_a" });
		await expect.element(page.getByText("Port the cards")).not.toBeInTheDocument();
	});

	it("shows a delegation to a subagent", async () => {
		await showChat(
			chatWith([
				toolPart("task", {
					input: { description: "Audit the login flow", subagent_type: "explore" },
					output: "<task_result>Looks fine</task_result>",
				}),
			]),
		);

		await expandUntil([turnWork], () =>
			expect(page.getByText("Audit the login flow").first().element()).toBeInTheDocument(),
		);
	});
});

describe("every built-in renderer, opened up", () => {
	const PATCH = [
		"*** Begin Patch",
		"*** Update File: src/login.ts",
		"@@ -1,2 +1,2 @@",
		" const a = 1;",
		"-const b = 2;",
		"+const b = 3;",
		"*** Add File: src/new.ts",
		"+export const fresh = true;",
		"*** Delete File: src/old.ts",
		"*** End Patch",
	].join("\n");

	const SETTLED_PARTS = [
		{ type: "reasoning", text: "Planning the change", time: { start: 1, end: 2 } },
		toolPart("read", { input: { filePath: "/projects/app/src/login.ts" } }, "r1"),
		toolPart("read", { input: { filePath: "/projects/app/src/auth.ts" } }, "r2"),
		toolPart(
			"grep",
			{ input: { pattern: "login", include: "*.ts" }, output: "Found 3 matches\nsrc/login.ts:1" },
			"g1",
		),
		toolPart(
			"glob",
			{ input: { pattern: "**/*.ts", path: "/projects/app" }, output: "src/a.ts\nsrc/b.ts" },
			"g2",
		),
		toolPart("list", { input: { path: "/projects/app/src" }, output: "a.ts\nb.ts" }, "g3"),
		toolPart("codebase_search", { input: { query: "where is auth" }, output: "src/auth.ts" }, "g4"),
		toolPart(
			"webfetch",
			{ input: { url: "https://example.com/docs", format: "markdown" }, output: "# Docs" },
			"w1",
		),
		toolPart("websearch", { input: { query: "oauth pkce" }, output: "Result: PKCE" }, "w2"),
		toolPart("skill", { input: { name: "tdd" }, output: "Loaded" }, "s1"),
		toolPart(
			"bash",
			{
				input: { command: "pnpm test", description: "Run tests" },
				output: "12 passed",
				metadata: { output: "12 passed", exit: 0 },
			},
			"b1",
		),
		toolPart("bash", { status: "error", input: { command: "make" }, error: "exit 2" }, "b2"),
		toolPart(
			"edit",
			{
				input: {
					filePath: "/projects/app/src/login.ts",
					oldString: "const b = 2;\n",
					newString: "const b = 3;\nconst c = 4;\n",
				},
			},
			"e1",
		),
		toolPart(
			"write",
			{
				input: {
					filePath: "/projects/app/src/new.ts",
					content: "export const x = 1;\nexport const y = 2;\n",
				},
			},
			"e2",
		),
		toolPart("apply_patch", { input: { patchText: PATCH } }, "p1"),
		toolPart(
			"question",
			{ input: { questions: [{ question: "Which?", options: [] }] }, output: "Answered" },
			"q1",
		),
		toolPart("github_list_issues", { output: "[]" }, "m1"),
		toolPart(
			"task",
			{
				input: { description: "Audit login", subagent_type: "explore" },
				output: "<task_result>ok</task_result>",
				metadata: { sessionId: "ses_child" },
			},
			"t1",
		),
		toolPart(
			"task",
			{
				status: "error",
				input: { description: "Audit auth", subagent_type: "general" },
				error: "Cancelled",
			},
			"t2",
		),
		{ type: "snapshot", snapshot: "abc" },
		{ type: "compaction", auto: true },
		{ type: "agent", name: "explore" },
		{ type: "mystery" },
		reply("All changed."),
	];

	it("draws a settled turn's work", async () => {
		await showChat(chatWith(SETTLED_PARTS));

		await expandAll();

		await expect.element(page.getByText("12 passed").first()).toBeInTheDocument();
		await expect.element(page.getByText("src/new.ts").first()).toBeInTheDocument();
		await expect.element(page.getByText("Audit login").first()).toBeInTheDocument();
	});

	it("draws a running turn's work as it happens", async () => {
		const host = await showChat([userMessage("ses_a", "msg_1", QUESTION)]);
		await vi.waitFor(() => expect(host.server.openStreams).toBe(1));
		const live = assistantMessage("ses_a", "msg_2", "msg_1", []);
		host.server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		host.server.emit("message.updated", {
			info: { ...live.info, time: { created: Date.now() }, finish: undefined },
		});
		const running = (part: Record<string, unknown>, id: string) => ({
			...part,
			id,
			sessionID: "ses_a",
			messageID: "msg_2",
			state: { ...(part.state as object), status: "running", time: { start: Date.now() } },
		});
		for (const [index, part] of SETTLED_PARTS.slice(1, -1).entries()) {
			host.server.emit("message.part.updated", { part: running(part, `part_${index}`) });
		}
		host.server.emit("message.part.updated", {
			part: {
				id: "part_retry",
				sessionID: "ses_a",
				messageID: "msg_2",
				type: "retry",
				attempt: 2,
				error: { name: "APIError", data: { message: "Overloaded" } },
				time: { created: Date.now() },
			},
		});

		await expect.element(page.getByRole("status").first()).toBeInTheDocument();
		await expandAll();
		await expect.element(page.getByText("Audit auth").first()).toBeInTheDocument();
	});
});

describe("the agent's HTML pages", () => {
	it.each(["desktop_chat_html_render", "desktop_kilo_ui_html_render"])(
		"shows a %s page above the reply, outside the fold",
		async (tool) => {
			await showChat(
				chatWith([
					toolPart(tool, { input: { title: "Sales chart", html: "<p>chart</p>" } }),
					reply("Sales doubled."),
				]),
			);

			await expect.element(page.getByTitle("Sales chart")).toBeInTheDocument();
			expect(expectPresent('iframe[title="Sales chart"]').getAttribute("sandbox")).toBe(
				"allow-scripts",
			);
		},
	);
});

describe("the tool-renderer point", () => {
	function Framed({ Original, ...props }: ToolRendererProps) {
		return (
			<div data-qa-id="acme-framed" data-tool={props.toolName}>
				<Original {...props} />
			</div>
		);
	}

	function Ping({ args }: ToolRendererProps) {
		return <p data-qa-id="acme-ping">Pinged {String((args as { host?: string }).host)}</p>;
	}

	const plugin = contributor(
		{
			"kilo.chat/tool-renderer": [
				{ id: "framed-bash", tools: ["bash"], priority: 10 },
				{ id: "ping", tools: ["desktop_acme_ping"], standalone: true, category: "web" },
			],
		},
		{
			web: {
				activate(sdk) {
					sdk.extensions.implement(ToolRenderer, "framed-bash", { component: Framed });
					sdk.extensions.implement(ToolRenderer, "ping", { component: Ping });
				},
			},
		},
	);

	it("lets a plugin draw its own tool, outside the fold when standalone", async () => {
		await showChat(
			chatWith([
				toolPart("desktop_acme_ping", { input: { host: "example.com" } }),
				reply("Reachable."),
			]),
			{ plugins: [plugin] },
		);

		await expect.element(page.getByTestId("acme-ping")).toHaveTextContent("Pinged example.com");
	});

	it("hands an override kilo.chat's renderer to wrap", async () => {
		await showChat(
			chatWith([
				toolPart("bash", {
					input: { command: "make", description: "Build" },
					output: "built",
					metadata: { output: "built", exit: 0 },
				}),
				reply("Built."),
			]),
			{ plugins: [plugin] },
		);

		await expandUntil([turnWork, button(/^(Ran|Build)/)], () =>
			expect(expectPresent('[data-qa-id="acme-framed"]').textContent).toMatch(/make|Build/),
		);
	});
});

describe("the markdown-extension point", () => {
	it("decorates the transcript's markdown, knowing where it is", async () => {
		const shout: MarkdownExtensionImplementation = (context) => ({
			decorateComponents: (next) => ({
				...next,
				strong: ({ children }) => (
					<strong data-qa-id="acme-shout" data-session={context.sessionId}>
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

describe("the mcp-app point", () => {
	const WIDGET = "<!doctype html><title>Acme list</title><p>widget</p>";

	it("frames a contributed widget for its tool's calls", async () => {
		const loadHtml = vi.fn(() => WIDGET);
		await showChat(chatWith([toolPart("desktop_acme_list", { output: "[]" }), reply("Listed.")]), {
			plugins: [
				contributor(
					{
						"kilo.chat/mcp-app": [
							{ id: "list", tools: ["desktop_acme_list"], resourceUri: "ui://acme/list" },
						],
					},
					{
						web: {
							activate(sdk) {
								sdk.extensions.implement(McpApp, "list", { loadHtml });
							},
						},
					},
				),
			],
		});

		await vi.waitFor(() => expectPresent('iframe[title="MCP App"]'), { timeout: 10_000 });
		expect(loadHtml).toHaveBeenCalled();
	});

	it("reads a widget without its own HTML from the tool's server", async () => {
		const server = new FakeKiloServer();
		server.resources["ui://acme/remote"] = { mimeType: "text/html;profile=mcp-app", text: WIDGET };
		server.addChat({
			id: "ses_a",
			directory: "/projects/app",
			title: "Chat",
			messages: chatWith([toolPart("desktop_acme_remote", { output: "[]" }), reply("Done.")]),
		});
		await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
			plugins: [
				contributor(
					{
						"kilo.chat/mcp-app": [
							{ id: "remote", tools: ["desktop_acme_remote"], resourceUri: "ui://acme/remote" },
						],
					},
					{},
				),
			],
		});

		await vi.waitFor(() => expectPresent('iframe[title="MCP App"]'), { timeout: 10_000 });
		expect(server.requestsTo("POST", "/experimental/resource/read")[0]?.body).toEqual({
			uri: "ui://acme/remote",
			server: "desktop",
		});
	});
});

describe("permission and question prompts", () => {
	async function liveChat() {
		const host = await showChat(chatWith([reply("Ready.")]));
		await vi.waitFor(() => expect(host.server.openStreams).toBe(1));
		return host;
	}

	it("replaces the composer with a permission card until the person answers", async () => {
		const host = await liveChat();

		host.server.askPermission("ses_a", {
			id: "per_1",
			permission: "bash",
			patterns: ["rm -rf build", "*"],
			always: ["rm *"],
			metadata: { description: "Clean the build" },
		});

		await expect.element(page.getByTestId("kilo-permission-card")).toBeVisible();
		await expect.element(page.getByText("rm -rf build")).toBeVisible();
		await expect.element(page.getByTestId("kilo-composer-input")).not.toBeInTheDocument();
		await page.getByTestId("kilo-permission-always").click();

		await expect
			.poll(() => host.server.requestsTo("POST", "/permission/per_1/reply")[0]?.body)
			.toMatchObject({ reply: "always" });
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
			return renderAgentPane({
				server,
				pane: agentPane({ metadata: { chatId: "ses_a" } }),
				chats: [chatSummary("ses_a")],
			});
		}

		it("shows the waiting permission card once the chat opens", async () => {
			const host = await openAfter((server) =>
				server.permissions.push({
					id: "per_away",
					sessionID: "ses_a",
					permission: "bash",
					patterns: ["git grep maxBytes"],
					metadata: {},
					always: [],
				}),
			);

			await expect.element(page.getByTestId("kilo-permission-card")).toBeVisible();
			await expect.element(page.getByText("git grep maxBytes")).toBeVisible();
			await page.getByTestId("kilo-permission-once").click();
			await expect
				.poll(() => host.server.requestsTo("POST", "/permission/per_away/reply")[0]?.body)
				.toMatchObject({ reply: "once" });
		});

		it("shows the waiting question once the chat opens", async () => {
			await openAfter((server) =>
				server.questions.push({
					id: "que_away",
					sessionID: "ses_a",
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
			await openAfter((server) =>
				server.permissions.push({
					id: "per_other",
					sessionID: "ses_other",
					permission: "bash",
					patterns: ["ls"],
					metadata: {},
					always: [],
				}),
			);

			await expect.element(page.getByTestId("kilo-composer-input")).toBeInTheDocument();
			await expect.element(page.getByTestId("kilo-permission-card")).not.toBeInTheDocument();
		});
	});

	it("accepts once on Enter, and says why a reply failed", async () => {
		const host = await liveChat();
		host.server.failingReplies.add("per_3");

		host.server.askPermission("ses_a", { id: "per_3", permission: "bash", patterns: ["ls"] });
		await expect.element(page.getByTestId("kilo-permission-card")).toBeVisible();
		(document.activeElement as HTMLElement | null)?.blur();
		document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

		await expect
			.poll(() => host.server.requestsTo("POST", "/permission/per_3/reply")[0]?.body)
			.toMatchObject({ reply: "once" });
		await expect.element(page.getByText(/expired|failed/i).first()).toBeVisible();
		await expect.element(page.getByTestId("kilo-permission-card")).toBeVisible();
	});

	it("offers only Allow once when Kilo has nothing to remember", async () => {
		const host = await liveChat();

		host.server.askPermission("ses_a", { id: "per_2", permission: "edit" });

		await expect.element(page.getByTestId("kilo-permission-once")).toBeVisible();
		await expect.element(page.getByTestId("kilo-permission-always")).not.toBeInTheDocument();
		await page.getByTestId("kilo-permission-reject").click();
		await expect
			.poll(() => host.server.requestsTo("POST", "/permission/per_2/reply")[0]?.body)
			.toMatchObject({ reply: "reject" });
	});

	it("shows what contributed interaction renderers add to a permission request", async () => {
		const seen: unknown[] = [];
		const InstallDetail = ({ request }: PermissionDetailProps) => {
			seen.push(request.args);
			const packages = (request.args as { packages?: string[] } | undefined)?.packages ?? [];
			return <p data-qa-id="acme-install-detail">Packages: {packages.join(", ")}</p>;
		};
		const host = await showChat(
			chatWith([
				toolPart(
					"desktop_acme_install",
					{ status: "running", input: { packages: ["numpy"] } },
					"call_install",
				),
			]),
			{
				plugins: [
					contributor(
						{
							"kilo.chat/interaction-renderer": [
								{ id: "install", permissions: ["desktop_acme_install"] },
								{ id: "elsewhere", permissions: ["bash"] },
							],
						},
						{
							web: {
								activate(sdk) {
									sdk.extensions.implement(InteractionRenderer, "install", {
										permissionTitle: () => "installing packages",
										PermissionDetail: InstallDetail,
										allowAlways: () => false,
									});
									sdk.extensions.implement(InteractionRenderer, "elsewhere", {
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
			permission: "desktop_acme_install",
			patterns: ["*"],
			always: ["*"],
			tool: { messageID: "msg_2", callID: "call_install" },
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
		expect(seen.at(-1)).toEqual({ packages: ["numpy"] });
	});

	it("warns under a question's answers that a contribution flags", async () => {
		const host = await showChat(chatWith([reply("Ready.")]), {
			plugins: [
				contributor(
					{ "kilo.chat/interaction-renderer": [{ id: "guard" }] },
					{
						web: {
							activate(sdk) {
								sdk.extensions.implement(InteractionRenderer, "guard", {
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
					custom: false,
				},
			],
		});

		await expect.element(page.getByText("How should I install it?")).toBeVisible();
		await expect.element(page.getByText("Risky.")).toBeVisible();
		expect(document.querySelectorAll('[data-slot="questionnaire-choice-warning"]')).toHaveLength(1);
	});

	it("asks the agent's questions in place of the composer", async () => {
		const host = await liveChat();

		host.server.askQuestion("ses_a", {
			id: "que_1",
			questions: [
				{
					question: "Which environment?",
					header: "Environment",
					options: [{ label: "Development", description: "Local services" }, { label: "Staging" }],
					custom: false,
				},
			],
		});

		await expect.element(page.getByText("Which environment?")).toBeVisible();
		document.querySelector<HTMLInputElement>('input[value="Development"]')!.click();
		await page.getByRole("button", { name: "Submit" }).click();

		await expect
			.poll(() => host.server.requestsTo("POST", "/question/que_1/reply")[0]?.body)
			.toEqual({ answers: [["Development"]] });
		await expect.element(page.getByTestId("kilo-composer-input")).toBeInTheDocument();
	});

	it("takes a typed answer when the question allows one", async () => {
		const host = await liveChat();

		host.server.askQuestion("ses_a", {
			id: "que_3",
			questions: [
				{
					question: "Which branch?",
					header: "Branch",
					options: [{ label: "main" }],
					custom: true,
				},
			],
		});

		await expect.element(page.getByText("Which branch?")).toBeVisible();
		const custom = page.getByRole("textbox").last();
		await custom.fill("release");
		await page.getByRole("button", { name: "Submit" }).click();
		await expect
			.poll(() => host.server.requestsTo("POST", "/question/que_3/reply")[0]?.body)
			.toEqual({ answers: [["release"]] });
	});

	it("dismisses a question", async () => {
		const host = await liveChat();

		host.server.askQuestion("ses_a", {
			id: "que_2",
			questions: [{ question: "Go on?", header: "Go", options: [{ label: "Yes" }] }],
		});

		await page.getByRole("button", { name: "Dismiss" }).click();
		await expect
			.poll(() => host.server.requestsTo("POST", "/question/que_2/reject").length)
			.toBe(1);
	});
});

describe("reverting and retrying", () => {
	const CHANGES = { summary: { diffs: [{ file: "login.ts", additions: 3, deletions: 1 }] } };

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

describe("a Kilo Gateway model refused while signed out", () => {
	it("offers to connect", async () => {
		const server = new FakeKiloServer();
		server.providers = {
			all: [
				{ id: "kilo", name: "Kilo", models: { auto: { id: "auto", name: "Auto", variants: {} } } },
			],
			default: { kilo: "auto" },
			connected: ["kilo"],
		};
		server.config = { model: "kilo/auto" };
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
		const host = await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
			identity: SIGNED_OUT,
		});

		await page.getByTestId("kilo-message-error-signin").click();

		await vi.waitFor(() => expect(host.signIn).toHaveBeenCalled());
	});
});

describe("tools that need sign-in", () => {
	const secretTools = contributor(
		{ "kilo.agent/tool": [{ id: "secret", title: "Read secrets", requiresSignIn: true }] },
		{
			main: {
				activate(sdk) {
					sdk.extensions.implement(
						AgentTool,
						"secret",
						defineTool({ description: "Reads secrets", input: z.object({}), run: () => "ok" }),
					);
				},
			},
		},
	);
	const refused = (callID: string) =>
		toolPart(
			toolWireName("acme.tools/secret"),
			{ status: "error", error: signInRequiredToolMessage("kilo") },
			callID,
		);

	it("asks a signed-out person to sign in where the call was refused", async () => {
		const host = await showChat(chatWith([refused("call_secret_1")]), {
			identity: SIGNED_OUT,
			plugins: [secretTools],
		});

		await expect.element(page.getByTestId("kilo-tool-signin-prompt")).toBeVisible();
		await page.getByTestId("kilo-tool-signin-prompt-signin").click();

		await vi.waitFor(() => expect(host.signIn).toHaveBeenCalled());
	});

	it("shows the tool's own sign-in prompt", async () => {
		const prompted = contributor(
			{
				"kilo.agent/tool": [
					{
						id: "secret",
						title: "Read secrets",
						requiresSignIn: true,
						signInPrompt: {
							title: "Use the vault?",
							body: "Sign in to read secrets.",
							toolsLabel: "the vault",
						},
					},
				],
			},
			{
				main: {
					activate(sdk) {
						sdk.extensions.implement(
							AgentTool,
							"secret",
							defineTool({ description: "Reads secrets", input: z.object({}), run: () => "ok" }),
						);
					},
				},
			},
		);
		await showChat(chatWith([refused("call_secret_prompt")]), {
			identity: SIGNED_OUT,
			plugins: [prompted],
		});

		const card = page.getByTestId("kilo-tool-signin-prompt");
		await expect.element(card.getByText("Use the vault?")).toBeVisible();
		await expect.element(card.getByText("Sign in to read secrets.")).toBeVisible();
	});

	it("tells the agent to carry on without the tools when the person declines", async () => {
		const host = await showChat(chatWith([refused("call_secret_2")]), {
			identity: SIGNED_OUT,
			plugins: [secretTools],
		});

		await page.getByTestId("kilo-tool-signin-prompt-decline").click();

		await expect.element(page.getByTestId("kilo-tool-signin-declined")).toBeVisible();
		await expect
			.poll(() => JSON.stringify(promptsTo(host.server)[0]?.body ?? ""))
			.toContain("continue without");
	});

	it("turns the tool's plugin off for the agent in kilo.agent when the person declines", async () => {
		const host = await showChat(chatWith([refused("call_secret_scope")]), {
			identity: SIGNED_OUT,
			plugins: [secretTools],
		});

		await page.getByTestId("kilo-tool-signin-prompt-decline").click();

		await vi.waitFor(() =>
			expect(host.agent.calls.declineSignIn).toHaveBeenCalledWith({ scope: "acme.tools" }),
		);
	});

	it("says the tools are off when kilo.agent has their plugin declined", async () => {
		await showChat(chatWith([refused("call_secret_elsewhere")]), {
			identity: SIGNED_OUT,
			plugins: [secretTools],
			declinedSignIns: ["acme.tools"],
		});

		await expect.element(page.getByTestId("kilo-tool-signin-declined")).toBeVisible();
	});

	it("says the tools are off for a call refused because the person already declined", async () => {
		await showChat(
			chatWith([
				toolPart(
					toolWireName("acme.tools/secret"),
					{ status: "error", error: SIGN_IN_DECLINED_TOOL_MESSAGE },
					"call_secret_after_decline",
				),
			]),
			{ identity: SIGNED_OUT, plugins: [secretTools] },
		);

		await expect.element(page.getByTestId("kilo-tool-signin-declined")).toBeVisible();
	});

	it("remembers a call declined before the upgrade from origin", async () => {
		await showChat(chatWith([refused("call_secret_origin")]), {
			identity: SIGNED_OUT,
			plugins: [secretTools],
			localStorage: {
				"kilo-ui.agent-tool-sign-in.declined-calls": JSON.stringify(["call_secret_origin"]),
			},
		});

		await expect.element(page.getByTestId("kilo-tool-signin-declined")).toBeVisible();
	});

	it("offers to continue once the person has signed in elsewhere", async () => {
		const host = await showChat(chatWith([refused("call_secret_3")]), {
			identity: SIGNED_IN,
			plugins: [secretTools],
		});

		await expect.element(page.getByTestId("kilo-tool-signin-signed-in")).toBeVisible();
		await page.getByTestId("kilo-tool-signin-continue").click();
		await expect
			.poll(() => JSON.stringify(promptsTo(host.server)[0]?.body ?? ""))
			.toContain("I've signed in. Please continue.");
	});

	const kiloProvider = (model: string) => ({
		all: [
			{ id: "kilo", name: "Kilo", models: { [model]: { id: model, name: model, variants: {} } } },
		],
		default: { kilo: model },
		connected: ["kilo"],
	});

	/**
	 * A signed-out chat on `kilo/free` whose tool call was refused, after clicking
	 * Sign in. `recorded` has Kilo report the chat's model, as it does once a
	 * prompt ran with it.
	 */
	async function signInFromRefusedCall(callID: string, { recorded = false } = {}) {
		const server = new FakeKiloServer();
		server.providers = kiloProvider("free");
		server.config = { model: "kilo/free" };
		server.addChat({
			id: "ses_a",
			directory: "/projects/app",
			title: "Chat",
			...(recorded ? { agent: "code", model: { providerID: "kilo", id: "free" } } : {}),
			messages: chatWith([refused(callID)], { model: { providerID: "kilo", modelID: "free" } }),
		});
		const host = await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
			identity: SIGNED_OUT,
			plugins: [secretTools],
		});
		await page.getByTestId("kilo-tool-signin-prompt-signin").click();
		await vi.waitFor(() => expect(host.signIn).toHaveBeenCalled());
		return { server, host };
	}

	it("continues after sign-in with a model the signed-in account offers", async () => {
		const { server, host } = await signInFromRefusedCall("call_secret_after_sign_in");
		server.providers = kiloProvider("balanced");
		server.config = { model: "kilo/balanced" };
		host.setIdentity(SIGNED_IN);

		await expect
			.poll(() => promptsTo(server)[0]?.body)
			.toMatchObject({ model: { providerID: "kilo", modelID: "balanced" } });
	});

	it("holds the follow-up when the signed-in model catalog can't be read", async () => {
		const { server, host } = await signInFromRefusedCall("call_secret_catalog_failed", {
			recorded: true,
		});
		const readsBefore = server.requestsTo("GET", "/provider").length;
		server.providers = { all: [], default: {}, connected: [] };
		host.setIdentity(SIGNED_IN);

		// An empty catalog is read once, then retried a bounded number of times before the query fails.
		await expect
			.poll(() => server.requestsTo("GET", "/provider").length - readsBefore, { timeout: 10_000 })
			.toBe(EMPTY_KILO_CATALOG_RETRY_LIMIT + 1);
		await new Promise((resolve) => setTimeout(resolve, 500));

		expect(promptsTo(server)).toEqual([]);
	});

	it("leaves other tools' errors that mention the marker alone", async () => {
		await showChat(
			chatWith([
				toolPart("bash", {
					status: "error",
					input: { command: "grep" },
					error: signInRequiredToolMessage("kilo"),
				}),
				reply("Searched."),
			]),
			{ identity: SIGNED_OUT, plugins: [secretTools] },
		);

		await expect.element(page.getByText("Searched.")).toBeVisible();
		expect(document.querySelector('[data-qa-id="kilo-tool-signin-prompt"]')).toBeNull();
	});
});
