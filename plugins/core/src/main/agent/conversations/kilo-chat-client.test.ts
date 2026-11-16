import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createKiloChatClient } from "./kilo-chat-client";

interface Seen {
	readonly method: string;
	readonly path: string;
	readonly directory: string | undefined;
	readonly body: unknown;
}

const chat = {
	id: "ses_a",
	title: "Fix login",
	directory: "/projects/app",
	metadata: { "kilo-desktop": {} },
	time: { created: 1, updated: 2 },
};

async function readBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk as Buffer);
	const text = Buffer.concat(chunks).toString("utf8");
	return text ? JSON.parse(text) : undefined;
}

/** A stand-in Kilo server that records each request's directory (header or query). */
async function fakeServer(
	options: { dropEvents?: boolean } = {},
): Promise<{ server: Server; url: string; seen: Seen[] }> {
	const seen: Seen[] = [];
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://localhost");
		const header = request.headers["x-kilo-directory"];
		seen.push({
			method: request.method ?? "GET",
			path: url.pathname,
			directory:
				typeof header === "string"
					? decodeURIComponent(header)
					: (url.searchParams.get("directory") ?? undefined),
			body: await readBody(request),
		});
		if (url.pathname === "/global/event") {
			if (options.dropEvents) {
				response.destroy();
				return;
			}
			response.setHeader("content-type", "text/event-stream");
			response.write(
				`data: ${JSON.stringify({ directory: "/projects/app", payload: { type: "session.idle", properties: { sessionID: "ses_a" } } })}\n\n`,
			);
			response.write(`data: ${JSON.stringify({ directory: "/x", payload: {} })}\n\n`);
			response.end();
			return;
		}
		response.setHeader("content-type", "application/json");
		const bodies: Record<string, unknown> = {
			"/experimental/session": [chat, { id: "broken" }],
			"/session/ses_a": chat,
			"/session/status": { ses_a: { type: "busy" } },
			"/permission": [{ id: "per_1", sessionID: "ses_a", permission: "bash" }],
			"/question": [{ id: "que_1", sessionID: "ses_a", questions: [] }],
			"/session": { ...chat, id: "ses_new" },
			"/session/ses_new/message": { info: { structured: { message: "Fix it" } }, parts: [] },
		};
		response.end(JSON.stringify(bodies[url.pathname] ?? true));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return { server, url: `http://127.0.0.1:${port}`, seen };
}

let running: Server | undefined;
afterEach(() => {
	running?.close();
	running = undefined;
});

async function connect(options?: Parameters<typeof fakeServer>[0]) {
	const { server, url, seen } = await fakeServer(options);
	running = server;
	const kilo = createKiloChatClient({
		baseUrl: url,
		username: "kilo",
		password: "secret",
		version: "7.8.17",
		globalDirectory: "/app/runtime",
	});
	return { kilo, seen };
}

const request = (seen: Seen[], method: string, path: string) =>
	seen.find((entry) => entry.method === method && entry.path === path);

describe("the Kilo chat client", () => {
	it("sends the drain token to the chat's directory", async () => {
		const { kilo, seen } = await connect();
		await kilo.drainChat(
			"/projects/app",
			"ses_a",
			"completion-token",
			new AbortController().signal,
		);
		expect(request(seen, "POST", "/kilocode/session/ses_a/drain")).toMatchObject({
			directory: "/projects/app",
			body: { token: "completion-token" },
		});
	});

	it("leaves dropped stream recovery to the conversations provider", async () => {
		const { kilo, seen } = await connect({ dropEvents: true });
		const events = [];
		for await (const event of kilo.events(new AbortController().signal)) events.push(event);
		expect(events).toEqual([]);
		expect(seen).toHaveLength(1);
	});

	it("reads every project's chats, statuses and prompts without a directory unless given one", async () => {
		const { kilo, seen } = await connect();

		const chats = await kilo.listChats();
		const one = await kilo.getChat("ses_a");
		const statuses = await kilo.statuses();
		await kilo.statuses("/projects/app");
		const permissions = await kilo.pendingPermissions();
		const questions = await kilo.pendingQuestions("/projects/app");

		expect(chats.map((entry) => entry.id)).toEqual(["ses_a"]);
		expect(one).toMatchObject({ id: "ses_a", directory: "/projects/app", updatedAt: 2 });
		expect(statuses).toEqual({ ses_a: { type: "busy" } });
		expect(permissions).toEqual([{ id: "per_1", sessionID: "ses_a" }]);
		expect(questions).toEqual([{ id: "que_1", sessionID: "ses_a" }]);
		expect(seen.map(({ path, directory }) => [path, directory])).toEqual([
			["/experimental/session", undefined],
			["/session/ses_a", undefined],
			["/session/status", undefined],
			["/session/status", "/projects/app"],
			["/permission", undefined],
			["/question", "/projects/app"],
		]);
	});

	it("writes to the directory it is given", async () => {
		const { kilo, seen } = await connect();

		const created = await kilo.createChat("/projects/app", {
			title: "New",
			metadata: { "kilo-desktop": {} },
			permission: [{ permission: "desktop_x", pattern: "*", action: "deny" }],
		});
		await kilo.updateChat("/projects/app", "ses_a", { title: "Renamed" });
		await kilo.updateChat("/projects/app", "ses_a", { archived: null });
		await kilo.deleteChat("/projects/app", "ses_a");
		await kilo.abortChat("/projects/app", "ses_a");
		await kilo.replyPermission("/projects/app", "per_1", "once", "ok");
		await kilo.replyQuestion("/projects/app", "que_1", [["Yes"]]);
		await kilo.rejectQuestion("/projects/app", "que_2");

		expect(created.id).toBe("ses_new");
		expect(request(seen, "POST", "/session")).toMatchObject({
			directory: "/projects/app",
			body: {
				title: "New",
				metadata: { "kilo-desktop": {} },
				permission: [{ permission: "desktop_x", pattern: "*", action: "deny" }],
			},
		});
		expect(seen.filter((entry) => entry.method === "PATCH").map((entry) => entry.body)).toEqual([
			{ title: "Renamed" },
			{ time: { archived: null } },
		]);
		expect(request(seen, "POST", "/permission/per_1/reply")?.body).toEqual({
			reply: "once",
			message: "ok",
		});
		expect(request(seen, "POST", "/question/que_1/reply")?.body).toEqual({ answers: [["Yes"]] });
		expect(seen.slice(1).every((entry) => entry.directory === "/projects/app")).toBe(true);
		expect(seen.map((entry) => `${entry.method} ${entry.path}`).slice(3)).toEqual([
			"DELETE /session/ses_a",
			"POST /session/ses_a/abort",
			"POST /permission/per_1/reply",
			"POST /question/que_1/reply",
			"POST /question/que_2/reject",
		]);
	});

	it("marks a person's approvals interactive, never a rejection", async () => {
		const { kilo, seen } = await connect();

		await kilo.replyPermission("/projects/app", "per_1", "always", undefined, true);
		await kilo.replyPermission("/projects/app", "per_2", "reject", undefined, true);
		await kilo.replyPermission("/projects/app", "per_3", "once");

		expect(request(seen, "POST", "/permission/per_1/reply")?.body).toEqual({
			reply: "always",
			interactive: true,
		});
		expect(request(seen, "POST", "/permission/per_2/reply")?.body).toEqual({ reply: "reject" });
		expect(request(seen, "POST", "/permission/per_3/reply")?.body).toEqual({ reply: "once" });
	});

	it("creates an unstamped chat and asks it for a structured answer", async () => {
		const { kilo, seen } = await connect();

		await kilo.createChat("/projects/app", { title: "Generate" });
		const answer = await kilo.promptStructured("/projects/app", "ses_new", {
			system: "Be brief.",
			text: "Patch",
			schema: { type: "object" },
			model: { providerID: "kilo", modelID: "fast", variant: "low" },
		});

		expect(answer).toEqual({ message: "Fix it" });
		expect(request(seen, "POST", "/session")?.body).toEqual({ title: "Generate" });
		expect(request(seen, "POST", "/session/ses_new/message")).toMatchObject({
			directory: "/projects/app",
			body: {
				model: { providerID: "kilo", modelID: "fast" },
				variant: "low",
				snapshotInitialization: "wait",
				format: { type: "json_schema", schema: { type: "object" } },
				system: "Be brief.",
				parts: [{ type: "text", text: "Patch" }],
			},
		});
	});

	it("sends a chat's prompt or slash command without waiting for the turn, and without a snapshot question", async () => {
		const { kilo, seen } = await connect();
		const parts = [{ type: "text", text: "Fix the login" }];

		await kilo.prompt("/projects/app", "ses_a", {
			parts,
			agent: "code",
			model: { providerID: "acme", modelID: "fast-1" },
			variant: "high",
			system: "Be brief.",
		});
		await kilo.command("/projects/app", "ses_a", {
			command: "review",
			arguments: "the diff",
			agent: "code",
			model: { providerID: "acme", modelID: "fast-1" },
			variant: "high",
		});

		expect(request(seen, "POST", "/session/ses_a/prompt_async")).toMatchObject({
			directory: "/projects/app",
			body: {
				parts,
				agent: "code",
				model: { providerID: "acme", modelID: "fast-1" },
				variant: "high",
				system: "Be brief.",
				snapshotInitialization: "wait",
			},
		});
		await expect
			.poll(() => request(seen, "POST", "/session/ses_a/command"))
			.toMatchObject({
				directory: "/projects/app",
				body: {
					command: "review",
					arguments: "the diff",
					agent: "code",
					model: "acme/fast-1",
					variant: "high",
					snapshotInitialization: "wait",
				},
			});
	});

	it("streams the server's events with the directory they came from", async () => {
		const { kilo } = await connect();
		const events = [];

		for await (const event of kilo.events(new AbortController().signal)) events.push(event);

		expect(events).toEqual([
			{ type: "session.idle", properties: { sessionID: "ses_a" }, directory: "/projects/app" },
		]);
	});
});
