import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createUnscopedChatDirectory } from "./unscoped-directory";

describe("createUnscopedChatDirectory", () => {
	let userData: string | undefined;
	afterEach(async () => {
		if (userData) await rm(userData, { recursive: true, force: true });
	});

	it("creates a unique folder under the app's chats folder", async () => {
		userData = await mkdtemp(path.join(os.tmpdir(), "kilo-agent-chats-"));
		const storage = path.join(userData, "plugins", "kilo.agent");
		const first = await createUnscopedChatDirectory(storage);
		const second = await createUnscopedChatDirectory(storage);
		expect(path.dirname(first)).toBe(path.join(userData, "chats"));
		expect(path.basename(first)).toMatch(/^session-/);
		expect(second).not.toBe(first);
		expect((await stat(first)).isDirectory()).toBe(true);
	});
});
