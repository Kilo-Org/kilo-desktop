import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWorkspacesDatabase, type WorkspacesDatabase } from "../workspaces/db.js";
import { SessionService } from "./SessionService.js";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../../drizzle");

describe("SessionService", () => {
	let root: string;
	let db: WorkspacesDatabase;
	let service: SessionService;
	let nextId: number;
	let clock: number;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "sessions-service-"));
		db = createWorkspacesDatabase(path.join(root, "data.db"), MIGRATIONS);
		nextId = 0;
		clock = 1_000;
		service = new SessionService(
			db,
			() => `wses_${++nextId}`,
			() => ++clock,
		);
	});

	afterEach(() => {
		db.$client.close();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("saves a draft session when its first chat is attached", () => {
		expect(service.attachChat("wses_draft", "ses_1")).toEqual({
			id: "wses_draft",
			chatIds: ["ses_1"],
		});
		expect(service.list()).toEqual([{ id: "wses_draft", chatIds: ["ses_1"] }]);
	});

	it("keeps a session's chats oldest first", () => {
		service.attachChat("wses_a", "ses_1");
		service.attachChat("wses_a", "ses_2");
		expect(service.list()).toEqual([{ id: "wses_a", chatIds: ["ses_1", "ses_2"] }]);
	});

	it("moves a chat attached to another session", () => {
		service.attachChat("wses_a", "ses_1");
		service.attachChat("wses_b", "ses_1");
		expect(service.list()).toEqual([
			{ id: "wses_a", chatIds: [] },
			{ id: "wses_b", chatIds: ["ses_1"] },
		]);
	});

	it("gives each chat without a session a newly minted session of its own", () => {
		service.attachChat("wses_a", "ses_1");
		expect(service.adoptChats(["ses_1", "ses_2", "ses_3", "ses_2"])).toEqual({
			ses_2: "wses_1",
			ses_3: "wses_2",
		});
		expect(service.list()).toEqual([
			{ id: "wses_a", chatIds: ["ses_1"] },
			{ id: "wses_1", chatIds: ["ses_2"] },
			{ id: "wses_2", chatIds: ["ses_3"] },
		]);
		expect(service.adoptChats(["ses_2"])).toEqual({});
	});

	it("deletes a session and unlinks its chats", () => {
		service.attachChat("wses_a", "ses_1");
		expect(service.delete("wses_a")).toBe(true);
		expect(service.delete("wses_a")).toBe(false);
		expect(service.list()).toEqual([]);
		expect(service.adoptChats(["ses_1"])).toEqual({ ses_1: "wses_1" });
	});

	it("deletes the session a detached chat leaves without chats", () => {
		service.attachChat("wses_a", "ses_1");
		service.attachChat("wses_a", "ses_2");
		expect(service.detachChat("ses_1")).toEqual({ unlinked: true, deletedSessionId: null });
		expect(service.list()).toEqual([{ id: "wses_a", chatIds: ["ses_2"] }]);
		expect(service.detachChat("ses_2")).toEqual({ unlinked: true, deletedSessionId: "wses_a" });
		expect(service.list()).toEqual([]);
		expect(service.detachChat("ses_unknown")).toEqual({ unlinked: false, deletedSessionId: null });
	});
});
