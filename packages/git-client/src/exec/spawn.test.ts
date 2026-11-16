import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import { spawn } from "./spawn.js";
import { cleanupTestDirs, createTestDir, testContext } from "../test/util.js";

afterEach(cleanupTestDirs);

function bufferOutput(subprocess: ReturnType<typeof spawn>) {
	return new Promise<string>((resolve, reject) => {
		const stdout: Buffer[] = [];
		subprocess.stdout?.on("data", (chunk) => {
			stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		});
		// 'exit' can fire while stdio still holds undelivered data; 'close' is
		// guaranteed to fire after the process ends and its streams are drained.
		subprocess.on("close", () => resolve(Buffer.concat(stdout).toString()));
		subprocess.on("error", reject);
	});
}

describe("spawn", () => {
	it("can launch git", async () => {
		const subprocess = spawn(["--version"], process.cwd(), testContext);
		const result = await bufferOutput(subprocess);
		expect(result.includes("git version")).toBe(true);
	});

	it("returns expected exit codes", async () => {
		const directory = await createTestDir("desktop-not-a-repo");
		const subprocess = spawn(["status"], directory, testContext);
		const code = await new Promise<number | null>((resolve) => {
			subprocess.on("exit", (code) => {
				resolve(code);
			});
		});

		expect(code).not.toBe(0);
	});
});
