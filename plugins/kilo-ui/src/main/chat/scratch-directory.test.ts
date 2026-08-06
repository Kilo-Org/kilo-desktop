import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
	ensureScratchChatDirectory,
	scratchChatDirectory,
	userDataRoot,
} from "./scratch-directory.js";

const CHAT_ID = "11111111-1111-4111-8111-111111111111";

describe("scratch chat directory", () => {
	it("derives userData from plugin storageDir and builds chats/<chatId>", () => {
		expect(userDataRoot("/app/userData/plugins/kilo-ui")).toBe(path.resolve("/app/userData"));
		expect(scratchChatDirectory("/app/userData", CHAT_ID)).toBe(
			path.resolve("/app/userData/chats", CHAT_ID),
		);
	});

	it("creates the scratch directory under userData/chats", async () => {
		const userData = await mkdtemp(path.join(os.tmpdir(), "kilo-ui-userdata-"));
		const storageDir = path.join(userData, "plugins", "kilo-ui");
		const directory = await ensureScratchChatDirectory(storageDir, CHAT_ID);
		expect(directory).toBe(path.join(userData, "chats", CHAT_ID));
		expect((await stat(directory)).isDirectory()).toBe(true);
	});

	it("rejects chat ids that escape the chats root", () => {
		expect(() => scratchChatDirectory("/app/userData", "../escape")).toThrow(/Invalid chat id/);
	});
});
