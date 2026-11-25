import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { createKiloClient } from "@kilocode/sdk/v2/client";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PermissionRule, ServerConnection } from "../../../contracts";
import { getKiloCliArtifact } from "../cli-distribution/artifacts.js";
import { createKiloChatClient } from "./kilo-chat-client";

const START_TIMEOUT_MS = 60_000;
const PASSWORD = "fork-test";

function bundledKiloExecutable(): string | undefined {
	try {
		const artifact = getKiloCliArtifact();
		const packageJson = createRequire(import.meta.url).resolve(
			`${artifact.packageName}/package.json`,
		);
		const executable = path.join(path.dirname(packageJson), "bin", artifact.executable);
		return existsSync(executable) ? executable : undefined;
	} catch {
		return undefined;
	}
}

const kiloExecutable = bundledKiloExecutable();

interface SyncPayload {
	readonly type?: string;
	readonly properties?: { readonly sessionID?: string };
	readonly syncEvent?: { readonly type?: string; readonly aggregateID?: string };
}

interface EventSubscription {
	/** Every `sync` copy of a message event the stream delivered. */
	readonly messageSyncs: SyncPayload[];
	/** Every chat any event on the stream was about. */
	readonly chatIds: Set<string>;
}

/**
 * What the fakes copy from the bundled CLI's fork (FakeKiloChats and the chat
 * tests' FakeKiloServer): it guards an upgrade that changes it.
 */
// The bundled CLI is now Kilo v2 (`kilo2`), and this drives chats through the
// v1 SDK; it moves to `@kilocode/client` with the chat client (Kilo V2 plan, step 6).
describe.skip("forking a chat in the bundled Kilo CLI", () => {
	let home: string;
	let project: string;
	let stopServer: (() => Promise<unknown>) | undefined;
	let connection: ServerConnection;
	let streams: AbortController;

	beforeEach(async () => {
		// The server reports real paths (macOS's /var is /private/var).
		home = await realpath(await mkdtemp(path.join(tmpdir(), "kilo-chat-fork-")));
		project = path.join(home, "project");
		await mkdir(project);
		streams = new AbortController();
		connection = await serve();
	}, START_TIMEOUT_MS);

	afterEach(async () => {
		streams.abort();
		await stopServer?.();
		await rm(home, { recursive: true, force: true });
	});

	async function serve(): Promise<ServerConnection> {
		const child = execa(kiloExecutable!, ["serve", "--hostname=127.0.0.1", "--port=0"], {
			cwd: project,
			reject: false,
			extendEnv: false,
			env: {
				PATH: process.env.PATH,
				SystemRoot: process.env.SystemRoot,
				HOME: home,
				USERPROFILE: home,
				XDG_CONFIG_HOME: path.join(home, ".config"),
				XDG_DATA_HOME: path.join(home, "data"),
				XDG_STATE_HOME: path.join(home, "state"),
				XDG_CACHE_HOME: path.join(home, "cache"),
				KILO_SERVER_PASSWORD: PASSWORD,
				KILO_TELEMETRY_LEVEL: "off",
				KILO_DISABLE_AUTOUPDATE: "true",
				KILO_DISABLE_MODELS_FETCH: "true",
				KILO_DISABLE_LSP_DOWNLOAD: "true",
			},
		});
		stopServer = () => {
			child.kill();
			return child;
		};
		const baseUrl = await new Promise<string>((resolve, reject) => {
			const lines = createInterface({ input: child.stdout! });
			const timer = setTimeout(() => reject(new Error("kilo serve never listened")), 50_000);
			lines.on("line", (line) => {
				const url = /\bon\s+(https?:\/\/[^\s]+)/i.exec(line)?.[1];
				if (!url) return;
				clearTimeout(timer);
				lines.close();
				child.stdout?.resume();
				resolve(new URL(url).origin);
			});
			void child.then(() => reject(new Error("kilo serve exited before listening")));
		});
		return { baseUrl, username: "kilo", password: PASSWORD, version: "", globalDirectory: home };
	}

	function sdk() {
		return createKiloClient({
			baseUrl: connection.baseUrl,
			headers: { Authorization: `Basic ${Buffer.from(`kilo:${PASSWORD}`).toString("base64")}` },
		});
	}

	/** The global event stream, with or without the fork-sync skip header. */
	async function subscribe(skipForkSync: boolean): Promise<EventSubscription> {
		const subscription: EventSubscription = { messageSyncs: [], chatIds: new Set() };
		const response = await sdk().global.event({
			signal: streams.signal,
			...(skipForkSync ? { headers: { "x-kilo-sse-skip-fork-sync": "1" } } : {}),
		});
		void (async () => {
			try {
				for await (const event of response.stream as AsyncIterable<{ payload?: SyncPayload }>) {
					const payload = event.payload;
					const chatId = payload?.syncEvent?.aggregateID ?? payload?.properties?.sessionID;
					if (chatId) subscription.chatIds.add(chatId);
					if (payload?.type === "sync" && payload.syncEvent?.type?.startsWith("message.")) {
						subscription.messageSyncs.push(payload);
					}
				}
			} catch {
				// Aborted when the test ends.
			}
		})();
		return subscription;
	}

	/**
	 * Resolves once every subscription's server-side bus listener is attached,
	 * so nothing emitted after it is missed. `server.connected` cannot prove
	 * that: the CLI sends it ahead of the lazily subscribed bus stream, so
	 * events right after it can be dropped on a slow machine. A probe chat each
	 * stream reports can, and is retried until one lands after the listeners.
	 */
	async function untilLive(...subscriptions: EventSubscription[]): Promise<void> {
		const kilo = createKiloChatClient(connection);
		const probes: string[] = [];
		await expect
			.poll(
				async () => {
					const reported = probes.some((id) =>
						subscriptions.every(({ chatIds }) => chatIds.has(id)),
					);
					if (!reported) probes.push((await kilo.createChat(project, {})).id);
					return reported;
				},
				{ timeout: 10_000, interval: 250 },
			)
			.toBe(true);
	}

	async function sendWithoutReply(chatId: string, text: string): Promise<string> {
		const { data } = await sdk().session.prompt(
			{ sessionID: chatId, directory: project, noReply: true, parts: [{ type: "text", text }] },
			{ throwOnError: true },
		);
		return data.info.id;
	}

	async function messageTexts(chatId: string): Promise<string[]> {
		const { data } = await sdk().session.messages(
			{ sessionID: chatId, directory: project },
			{ throwOnError: true },
		);
		return data.flatMap(({ parts }) =>
			parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
		);
	}

	it("copies the messages before the fork point and the stamp, but not the rules", async () => {
		const kilo = createKiloChatClient(connection);
		const rules: PermissionRule[] = [
			{ permission: "external_directory", pattern: "/projects/lib", action: "allow" },
			{ permission: "bash", pattern: "*", action: "ask" },
		];
		const stamp = { "kilo-desktop": { workSessionId: "wses_1" } };
		const source = await kilo.createChat(project, { metadata: stamp, permission: rules });
		await sendWithoutReply(source.id, "Fix the login");
		const second = await sendWithoutReply(source.id, "Now the signup");
		const withHeader = await subscribe(true);
		const withoutHeader = await subscribe(false);
		await untilLive(withHeader, withoutHeader);

		const fork = await kilo.forkChat(project, source.id, second);

		expect(fork).toMatchObject({ parentId: null, directory: project, metadata: stamp });
		expect(fork.title).toMatch(/\(fork #1\)$/);
		expect(await messageTexts(fork.id)).toEqual(["Fix the login"]);
		expect(await kilo.getChatPermission(project, source.id)).toEqual(rules);
		expect(await kilo.getChatPermission(project, fork.id)).toEqual([]);

		await kilo.updateChat(project, fork.id, { permission: rules });
		expect(await kilo.getChatPermission(project, fork.id)).toEqual(rules);

		await expect
			.poll(() => withoutHeader.messageSyncs.length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		expect(withHeader.messageSyncs).toEqual([]);
	});

	it("keeps a fork's hidden note as a synthetic part that starts no turn", async () => {
		const kilo = createKiloChatClient(connection);
		const source = await kilo.createChat(project, {});
		await sendWithoutReply(source.id, "Fix the login");
		const second = await sendWithoutReply(source.id, "Now the signup");
		const fork = await kilo.forkChat(project, source.id, second);

		await kilo.recordForkHandoff(project, fork.id);

		await expect.poll(async () => (await messages(fork.id)).length, { timeout: 10_000 }).toBe(2);
		const [, note] = await messages(fork.id);
		expect(note?.info.role).toBe("user");
		expect(note?.parts).toEqual([
			expect.objectContaining({
				type: "text",
				synthetic: true,
				text: expect.stringContaining(`Use this as the current working directory: ${project}`),
			}),
		]);
		expect((await messages(fork.id)).some(({ info }) => info.role === "assistant")).toBe(false);
		await expect
			.poll(async () => (await kilo.statuses(project))[fork.id]?.type ?? "idle")
			.toBe("idle");
	});

	async function messages(chatId: string) {
		const { data } = await sdk().session.messages(
			{ sessionID: chatId, directory: project },
			{ throwOnError: true },
		);
		return data;
	}
});
