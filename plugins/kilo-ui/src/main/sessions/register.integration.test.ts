import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { createFakeMainSdk, type FakeMainSdk } from "@kilo-desktop/testing";

import { createWorkspacesDatabase, type WorkspacesDatabase } from "../workspaces/db.js";
import { registerSessions } from "./register.js";
import { SessionService } from "./SessionService.js";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../../drizzle");

describe("work sessions over IPC", () => {
	let root: string;
	let db: WorkspacesDatabase;
	let sdk: FakeMainSdk;
	let renameSessions: Mock<(renames: Readonly<Record<string, string>>) => void>;
	let changed: Mock<(payload: unknown) => void>;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "sessions-register-"));
		db = createWorkspacesDatabase(path.join(root, "data.db"), MIGRATIONS);
		sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		renameSessions = vi.fn();
		let nextId = 0;
		registerSessions(sdk, db, { renameSessions }, new SessionService(db, () => `wses_${++nextId}`));
		changed = vi.fn();
		sdk.events.on("kilo-ui.sessions-changed", changed);
	});

	afterEach(() => {
		sdk.dispose();
		db.$client.close();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("saves a draft with its first chat and announces the change", async () => {
		await expect(
			sdk.invoke("sessions.attachChat", { sessionId: "wses_draft", kiloSessionId: "ses_1" }),
		).resolves.toEqual({ id: "wses_draft", chatIds: ["ses_1"] });
		await expect(sdk.invoke("sessions.list")).resolves.toEqual({
			sessions: [{ id: "wses_draft", chatIds: ["ses_1"] }],
		});
		expect(changed).toHaveBeenCalledOnce();
	});

	it("adopts unlinked chats and moves their board cards to the new sessions", async () => {
		await sdk.invoke("sessions.attachChat", { sessionId: "wses_draft", kiloSessionId: "ses_1" });
		changed.mockClear();

		await expect(
			sdk.invoke("sessions.adoptChats", { kiloSessionIds: ["ses_1", "ses_2"] }),
		).resolves.toEqual({ adopted: { ses_2: "wses_1" } });
		expect(renameSessions).toHaveBeenCalledWith({ ses_2: "wses_1" });
		expect(changed).toHaveBeenCalledOnce();

		changed.mockClear();
		await sdk.invoke("sessions.adoptChats", { kiloSessionIds: ["ses_2"] });
		expect(renameSessions).toHaveBeenCalledOnce();
		expect(changed).not.toHaveBeenCalled();
	});

	it("deletes the session whose last chat is detached", async () => {
		await sdk.invoke("sessions.attachChat", { sessionId: "wses_a", kiloSessionId: "ses_1" });
		await expect(sdk.invoke("sessions.detachChat", { kiloSessionId: "ses_1" })).resolves.toEqual({
			deletedSessionId: "wses_a",
		});
		await expect(sdk.invoke("sessions.delete", { sessionId: "wses_a" })).resolves.toEqual({
			deleted: false,
		});
		await expect(sdk.invoke("sessions.list")).resolves.toEqual({ sessions: [] });
	});
});
