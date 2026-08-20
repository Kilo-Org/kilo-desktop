import { describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import type { KiloGlobalConnection } from "../../contracts/chat/schemas.js";
import {
	createKiloUnscopeClient,
	createWorkspaceSessionUnscoper,
	unscopeAnacondaMetadata,
	unscopeWorkspaceSessions,
	type SessionUnscopeClient,
} from "./unscope-workspace-sessions.js";

const CONNECTION = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	globalDirectory: "/plugin-data/kilo-server/runtime",
} satisfies KiloGlobalConnection;

function fakeClient(
	sessions: Array<{ id: string; directory?: string; metadata?: unknown }>,
	update = vi.fn(async () => undefined),
): SessionUnscopeClient & { updateMetadata: ReturnType<typeof vi.fn> } {
	return {
		listSessions: async () => sessions,
		updateMetadata: update,
	};
}

describe("unscopeAnacondaMetadata", () => {
	it("clears the deleted workspace stamp and keeps the session Anaconda-owned", () => {
		expect(
			unscopeAnacondaMetadata(
				{
					anaconda: {
						workspaceId: "ws-1",
						workspaceFolders: [{ path: "/repo", isPrimary: true }],
					},
					other: "kept",
				},
				"ws-1",
			),
		).toEqual({ anaconda: {}, other: "kept" });
	});

	it("leaves unrelated sessions unchanged", () => {
		expect(unscopeAnacondaMetadata({ anaconda: { workspaceId: "ws-2" } }, "ws-1")).toBeNull();
		expect(unscopeAnacondaMetadata({ anaconda: {} }, "ws-1")).toBeNull();
		expect(unscopeAnacondaMetadata({ other: "x" }, "ws-1")).toBeNull();
		expect(unscopeAnacondaMetadata(undefined, "ws-1")).toBeNull();
	});
});

describe("unscopeWorkspaceSessions", () => {
	it("patches only sessions stamped with the deleted workspace", async () => {
		const update = vi.fn(async () => undefined);
		const client = fakeClient(
			[
				{
					id: "ses-match",
					directory: "/repo/project",
					metadata: { anaconda: { workspaceId: "ws-1" } },
				},
				{
					id: "ses-other",
					directory: "/repo/other",
					metadata: { anaconda: { workspaceId: "ws-2" } },
				},
				{ id: "ses-unscoped", directory: "/chats/session-abc", metadata: { anaconda: {} } },
			],
			update,
		);

		await unscopeWorkspaceSessions(client, "ws-1");

		expect(update).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledWith({
			sessionID: "ses-match",
			directory: "/repo/project",
			metadata: { anaconda: {} },
		});
	});

	it("lists and updates through a global Kilo client", async () => {
		const list = vi.fn(async () => ({
			data: [
				{
					id: "ses-1",
					directory: "/repo",
					metadata: { anaconda: { workspaceId: "ws-1" } },
				},
			],
		}));
		const update = vi.fn(async () => ({ data: {} }));
		const client = createKiloUnscopeClient(
			CONNECTION,
			() =>
				({
					experimental: { session: { list } },
					session: { update },
				}) as never,
		);

		await unscopeWorkspaceSessions(client, "ws-1");

		expect(list).toHaveBeenCalledWith({ roots: true, archived: true }, { throwOnError: true });
		expect(update).toHaveBeenCalledWith(
			{
				sessionID: "ses-1",
				directory: "/repo",
				metadata: { anaconda: {} },
			},
			{ throwOnError: true },
		);
	});
});

describe("createWorkspaceSessionUnscoper", () => {
	it("reports when Kilo Server is unavailable so cleanup can be retried", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "kilo-ui" });
		const createClient = vi.fn();
		const unscope = createWorkspaceSessionUnscoper(mainSdk, createClient);

		await expect(unscope("ws-1")).rejects.toThrow("Kilo Server is unavailable.");
		expect(createClient).not.toHaveBeenCalled();
		mainSdk.dispose();
	});

	it("reports session update failures so cleanup can be retried", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({
			featureId: "kilo-ui",
		});
		const kiloServer = createMainSdk("kilo-server");
		kiloServer.plugins.expose("connectionService", {
			getConnection: async () => CONNECTION,
		});
		const unscope = createWorkspaceSessionUnscoper(mainSdk, () => {
			throw new Error("Kilo is unreachable.");
		});

		await expect(unscope("ws-1")).rejects.toThrow("Kilo is unreachable.");
		kiloServer.dispose();
		mainSdk.dispose();
	});

	it("unscopes matching chats through the live Kilo connection", async () => {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-ui" });
		const kiloServer = createMainSdk("kilo-server");
		kiloServer.plugins.expose("connectionService", {
			getConnection: async () => CONNECTION,
		});
		const update = vi.fn(async () => undefined);
		const unscope = createWorkspaceSessionUnscoper(mainSdk, () =>
			fakeClient(
				[{ id: "ses-1", directory: "/repo", metadata: { anaconda: { workspaceId: "ws-1" } } }],
				update,
			),
		);

		await unscope("ws-1");
		expect(update).toHaveBeenCalledWith({
			sessionID: "ses-1",
			directory: "/repo",
			metadata: { anaconda: {} },
		});
		kiloServer.dispose();
		mainSdk.dispose();
	});
});
