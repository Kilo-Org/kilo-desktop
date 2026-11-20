import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { z } from "zod";

import type { PluginEntry } from "@kilo-desktop/kernel";
import {
	defineTool,
	SIGN_IN_DECLINED_TOOL_ERROR_CODE,
	SIGN_IN_REQUIRED_TOOL_ERROR_CODE,
	Tool,
	toolWireName,
	type ModelsState,
} from "@kilo-desktop/plugin-core/contracts";

import { chatPaneObject, McpApp, ToolRenderer, type ToolRendererProps } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import {
	assistantMessage,
	FakeKiloServer,
	userMessage,
	type FakeMessage,
} from "../../test/fake-kilo-server";
import { SIGNED_IN, SIGNED_OUT, TEST_MODELS } from "../../test/chat-host";
import {
	button,
	expandAll,
	expandUntil,
	expectPresent,
	toolPart,
	turnWork,
} from "../../test/transcript";
import { renderChat } from "../../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

const QUESTION = "What does login do?";

const signInRequiredToolMessage = () =>
	`${SIGN_IN_REQUIRED_TOOL_ERROR_CODE} The user is not signed in to Kilo, so this tool did not run.`;
const SIGN_IN_DECLINED_TOOL_MESSAGE = `${SIGN_IN_DECLINED_TOOL_ERROR_CODE} The user chose not to sign in.`;

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
			requires: {
				"kilo.chat/tool-renderer": "optional",
				"kilo.chat/mcp-app": "optional",
				"kilo.core/tool": "optional",
			},
			contributes: { extensions },
		},
		...entries,
	};
}

const reply = (text: string) => ({ type: "text", text, time: { start: 3, end: 4 } });

/** The code agent remembers Acme's model, so a turn sent after sign-in has a model to run with. */
const REMEMBERED_MODEL = {
	...TEST_MODELS,
	preferences: {
		...TEST_MODELS.preferences,
		byAgent: { code: { aiProviderId: "acme", modelId: "fast-1" } },
	},
};

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
				{ id: "ping", tools: ["acme.tools/ping"], standalone: true, category: "web" },
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
				toolPart(toolWireName("acme.tools/ping"), { input: { host: "example.com" } }),
				reply("Reachable."),
			]),
			{ plugins: [plugin] },
		);

		await expect.element(page.getByTestId("acme-ping")).toHaveTextContent("Pinged example.com");
	});

	it("keeps out of the fold only the calls a renderer picks to stand alone", async () => {
		function Install({ toolCallId, isError }: ToolRendererProps) {
			return (
				<p data-qa-id={`acme-install-${toolCallId}`}>{isError ? "Install blocked" : "Installed"}</p>
			);
		}
		const installs = contributor(
			{ "kilo.chat/tool-renderer": [{ id: "install", tools: ["acme.tools/install"] }] },
			{
				web: {
					activate(sdk) {
						sdk.extensions.implement(ToolRenderer, "install", {
							component: Install,
							isStandalone: (call) => call.isError === true,
						});
					},
				},
			},
		);
		const install = toolWireName("acme.tools/install");

		await showChat(
			chatWith([
				toolPart(install, { input: { name: "numpy" } }, "call_ok"),
				toolPart(
					install,
					{ status: "error", input: { name: "pillow" }, error: "blocked" },
					"call_blocked",
				),
				reply("Pillow is blocked."),
			]),
			{ plugins: [installs] },
		);

		await expect.element(page.getByTestId("acme-install-call_blocked")).toBeVisible();
		await expect.element(page.getByTestId("acme-install-call_ok")).not.toBeInTheDocument();
		await expandAll();
		await expect.element(page.getByTestId("acme-install-call_ok")).toHaveTextContent("Installed");
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

describe("the mcp-app point", () => {
	const WIDGET = "<!doctype html><title>Acme list</title><p>widget</p>";

	it("frames a contributed widget for its tool's calls", async () => {
		const loadHtml = vi.fn(() => WIDGET);
		await showChat(
			chatWith([toolPart(toolWireName("acme.tools/list"), { output: "[]" }), reply("Listed.")]),
			{
				plugins: [
					contributor(
						{
							"kilo.chat/mcp-app": [
								{ id: "list", tools: ["acme.tools/list"], resourceUri: "ui://acme/list" },
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
			},
		);

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
			messages: chatWith([
				toolPart(toolWireName("acme.tools/remote"), { output: "[]" }),
				reply("Done."),
			]),
		});
		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
			plugins: [
				contributor(
					{
						"kilo.chat/mcp-app": [
							{ id: "remote", tools: ["acme.tools/remote"], resourceUri: "ui://acme/remote" },
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

describe("tools that need sign-in", () => {
	const secretTools = contributor(
		{ "kilo.core/tool": [{ id: "secret", title: "Read secrets", requiresSignIn: true }] },
		{
			main: {
				activate(sdk) {
					sdk.extensions.implement(
						Tool,
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
			{ status: "error", error: signInRequiredToolMessage() },
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
				"kilo.core/tool": [
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
							Tool,
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

	it("turns the tool's plugin off for the agent in kilo.core when the person declines", async () => {
		const host = await showChat(chatWith([refused("call_secret_scope")]), {
			identity: SIGNED_OUT,
			plugins: [secretTools],
		});

		await page.getByTestId("kilo-tool-signin-prompt-decline").click();

		await vi.waitFor(() =>
			expect(host.agent.calls.declineSignInTools).toHaveBeenCalledWith({ pluginId: "acme.tools" }),
		);
	});

	it("says the tools are off when kilo.core has their plugin declined", async () => {
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
			models: REMEMBERED_MODEL,
			plugins: [secretTools],
		});

		await expect.element(page.getByTestId("kilo-tool-signin-signed-in")).toBeVisible();
		await page.getByTestId("kilo-tool-signin-continue").click();
		await expect
			.poll(() => JSON.stringify(promptsTo(host.server)[0]?.body ?? ""))
			.toContain("I've signed in. Please continue.");
	});

	it("continues once the person signs in from the card", async () => {
		const host = await showChat(chatWith([refused("call_secret_after_sign_in")]), {
			identity: SIGNED_OUT,
			models: REMEMBERED_MODEL,
			plugins: [secretTools],
		});
		await page.getByTestId("kilo-tool-signin-prompt-signin").click();
		await vi.waitFor(() => expect(host.signIn).toHaveBeenCalled());

		host.setIdentity(SIGNED_IN);

		await expect
			.poll(() => JSON.stringify(promptsTo(host.server)[0]?.body ?? ""))
			.toContain("I've signed in. Please continue.");
	});

	/** kilo.core's models when Kilo's gateway offers only `modelId`, its default. */
	const kiloModels = (modelId: string): ModelsState => ({
		...TEST_MODELS,
		aiProviders: {
			kilo: {
				id: "kilo",
				name: "Kilo Gateway",
				connected: true,
				source: "kilo",
				env: [],
				canDisconnect: false,
			},
		},
		models: {
			[`kilo/${modelId}`]: {
				aiProviderId: "kilo",
				modelId,
				name: modelId,
				variants: [],
				attachments: true,
				reasoning: false,
				free: false,
				byok: false,
			},
		},
		defaults: { kilo: modelId },
		configuredModel: { aiProviderId: "kilo", modelId },
	});

	it("continues after sign-in only once the signed-in account's models are read", async () => {
		const server = new FakeKiloServer();
		server.addChat({
			id: "ses_a",
			directory: "/projects/app",
			title: "Chat",
			agent: "code",
			model: { providerID: "kilo", id: "kilo-auto/free" },
			messages: chatWith([refused("call_secret_race")], {
				model: { providerID: "kilo", modelID: "kilo-auto/free" },
			}),
		});
		const host = await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
			identity: SIGNED_OUT,
			models: kiloModels("kilo-auto/free"),
			plugins: [secretTools],
		});
		await page.getByTestId("kilo-tool-signin-prompt-signin").click();
		await vi.waitFor(() => expect(host.signIn).toHaveBeenCalled());

		// kilo.core as sign-in finishes: its models follow the new account before
		// the account's change reaches the window, and are read for it a moment later.
		const models = host.core.models();
		models.setState({ ...models.state, followingAccount: true });
		host.setIdentity(SIGNED_IN);
		// The card shows the signed-in row as soon as the identity reaches it; a
		// turn sent before the models settle would still carry the signed-out one.
		await expect.element(page.getByTestId("kilo-tool-signin-signed-in")).toBeVisible();
		await expect.element(page.getByTestId("kilo-tool-signin-continue")).not.toBeInTheDocument();
		expect(promptsTo(server)).toEqual([]);

		models.setState(kiloModels("kilo-auto/balanced"));

		await expect
			.poll(() => promptsTo(server)[0]?.body)
			.toMatchObject({ model: { providerID: "kilo", modelID: "kilo-auto/balanced" } });
	});

	it("leaves other tools' errors that mention the marker alone", async () => {
		await showChat(
			chatWith([
				toolPart("bash", {
					status: "error",
					input: { command: "grep" },
					error: signInRequiredToolMessage(),
				}),
				reply("Searched."),
			]),
			{ identity: SIGNED_OUT, plugins: [secretTools] },
		);

		await expect.element(page.getByText("Searched.")).toBeVisible();
		expect(document.querySelector('[data-qa-id="kilo-tool-signin-prompt"]')).toBeNull();
	});
});
