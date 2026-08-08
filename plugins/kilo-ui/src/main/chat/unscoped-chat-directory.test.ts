import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createUnscopedChatDirectory } from "./unscoped-chat-directory.js";

describe("unscoped chat directory", () => {
	it("creates a unique persistent directory under the app-level chats folder", async () => {
		const userData = await mkdtemp(path.join(os.tmpdir(), "kilo-ui-user-data-"));
		const storageDir = path.join(userData, "plugins", "kilo-ui");
		try {
			const first = await createUnscopedChatDirectory(storageDir);
			const second = await createUnscopedChatDirectory(storageDir);
			expect(first).not.toBe(second);
			expect(path.dirname(first)).toBe(path.join(userData, "chats"));
			expect(path.basename(first)).toMatch(/^session-/);
			expect((await stat(first)).isDirectory()).toBe(true);
			expect((await stat(second)).isDirectory()).toBe(true);
		} finally {
			await rm(userData, { recursive: true, force: true });
		}
	});
});
