import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { signalReleaseSmokeReady } from "./release-smoke.js";

describe("signalReleaseSmokeReady", () => {
	let directory: string;
	let readyFile: string;

	beforeEach(async () => {
		directory = await mkdtemp(path.join(os.tmpdir(), "release-smoke-"));
		readyFile = path.join(directory, "ready");
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it("writes the ready file the release smoke script waits for", async () => {
		await signalReleaseSmokeReady({ CI: "true", KILO_RELEASE_SMOKE_READY_FILE: readyFile });

		await expect(readFile(readyFile, "utf8")).resolves.toBe("ready\n");
	});

	it("does nothing outside CI so a stray variable cannot write files for users", async () => {
		await signalReleaseSmokeReady({ KILO_RELEASE_SMOKE_READY_FILE: readyFile });

		await expect(readFile(readyFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("does nothing in CI when no ready file is requested", async () => {
		await expect(signalReleaseSmokeReady({ CI: "true" })).resolves.toBeUndefined();
	});
});
