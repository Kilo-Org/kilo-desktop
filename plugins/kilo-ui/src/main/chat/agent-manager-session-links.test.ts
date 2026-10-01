import { describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@kilo-desktop/testing";

import type { KiloGlobalConnection } from "../../contracts/chat/schemas.js";
import {
	selectWorktreeSessionLinks,
	startAgentManagerLinkBackfill,
	type LinkableSession,
} from "./agent-manager-session-links.js";

const CONNECTION = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "7.6.2",
	globalDirectory: "/plugin-data/kilo-server/runtime",
} satisfies KiloGlobalConnection;

function worktreeSession(
	id: string,
	directory: string,
	time: LinkableSession["time"],
): LinkableSession {
	return {
		id,
		directory,
		time,
		metadata: { "kilo-desktop": { worktree: { branch: `kilo/${id}` } } },
	};
}

describe("selectWorktreeSessionLinks", () => {
	it("prefers the newest live session per worktree, falling back to archived", () => {
		const links = selectWorktreeSessionLinks([
			worktreeSession("old-live", "/wt/a", { updated: 1 }),
			worktreeSession("new-archived", "/wt/a", { updated: 9, archived: 9 }),
			worktreeSession("new-live", "/wt/a", { updated: 5 }),
			worktreeSession("only-archived", "/wt/b", { updated: 3, archived: 4 }),
		]);

		expect(links).toEqual([
			{ directory: "/wt/a", sessionId: "new-live" },
			{ directory: "/wt/b", sessionId: "only-archived" },
		]);
	});

	it("skips sessions without a worktree stamp and subagent sessions", () => {
		const links = selectWorktreeSessionLinks([
			{ id: "plain", directory: "/repo", time: { updated: 1 }, metadata: { "kilo-desktop": {} } },
			{ id: "cli", directory: "/repo", time: { updated: 1 } },
			{ ...worktreeSession("child", "/wt/c", { updated: 1 }), parentID: "parent" },
			{
				id: "pre-rename",
				directory: "/wt/d",
				time: { updated: 1 },
				metadata: { anaconda: { worktree: { branch: "kilo/x" } } },
			},
		]);

		expect(links).toEqual([{ directory: "/wt/d", sessionId: "pre-rename" }]);
	});
});

describe("startAgentManagerLinkBackfill", () => {
	function setup(link = vi.fn(async () => true)) {
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-ui" });
		const kiloServer = createMainSdk("kilo-server");
		kiloServer.plugins.expose("connectionService", { getConnection: async () => CONNECTION });
		const git = createMainSdk("git");
		git.plugins.expose("gitService", { linkAgentManagerSession: link });
		const listSessions = vi.fn(async () => [worktreeSession("ses_1", "/wt/a", { updated: 1 })]);
		const stop = startAgentManagerLinkBackfill(mainSdk, listSessions);
		const emitStatus = (status: string) =>
			kiloServer.events.emit("server-status-changed", { status });
		const dispose = () => {
			stop();
			git.dispose();
			kiloServer.dispose();
			mainSdk.dispose();
		};
		return { link, listSessions, emitStatus, dispose };
	}

	it("links worktree sessions once, on the first ready status", async () => {
		const { link, listSessions, emitStatus, dispose } = setup();

		emitStatus("starting");
		expect(listSessions).not.toHaveBeenCalled();

		emitStatus("ready");
		await vi.waitFor(() =>
			expect(link).toHaveBeenCalledWith({ path: "/wt/a", sessionId: "ses_1" }),
		);
		emitStatus("ready");
		await Promise.resolve();
		expect(listSessions).toHaveBeenCalledTimes(1);
		dispose();
	});

	it("retries on the next ready after the session list fails", async () => {
		const { link, listSessions, emitStatus, dispose } = setup();
		listSessions.mockRejectedValueOnce(new Error("Kilo is unreachable."));

		emitStatus("ready");
		await vi.waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));
		await new Promise((resolve) => setTimeout(resolve, 0));
		emitStatus("ready");

		await vi.waitFor(() => expect(link).toHaveBeenCalledTimes(1));
		dispose();
	});

	it("does not fail the backfill when one link throws", async () => {
		const link = vi.fn(async () => {
			throw new Error("permission denied");
		});
		const { listSessions, emitStatus, dispose } = setup(link);

		emitStatus("ready");
		await vi.waitFor(() => expect(link).toHaveBeenCalledTimes(1));
		await new Promise((resolve) => setTimeout(resolve, 0));
		emitStatus("ready");
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(listSessions).toHaveBeenCalledTimes(1);
		dispose();
	});
});
