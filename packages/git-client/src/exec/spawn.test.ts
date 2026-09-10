import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import { spawn } from "./spawn.js";
import { cleanupTestDirs, createTestDir, gitExec, testContext } from "../test/util.js";

afterEach(cleanupTestDirs);

// Same known V8 limit on string size.
const maximumStringSize = 268_435_441;

function bufferOutput(subprocess: ReturnType<typeof spawn>, failPromiseWhenLengthExceeded = true) {
	return new Promise<string>((resolve, reject) => {
		const stdout: Buffer[] = [];
		subprocess.stdout?.on("data", (chunk) => {
			stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		});
		// 'exit' fires when the OS reports the child terminated, possibly before
		// the parent has drained the stdio pipes; 'close' fires only after all
		// stdio has been delivered, so the buffer is complete here.
		subprocess.on("close", () => {
			const output = Buffer.concat(stdout);
			if (failPromiseWhenLengthExceeded && output.length >= maximumStringSize) {
				reject(
					new Error(
						`Process output is greater than known V8 limit on string size: ${maximumStringSize} bytes`,
					),
				);
			} else {
				resolve(output.toString());
			}
		});
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

	// Writes ~256MB to disk and streams it back through git; slow/shared CI
	// runners can exceed even the package's raised testTimeout, so this test
	// carries its own much larger budget.
	it("can fail safely with a diff exceeding the string length", async () => {
		const testRepoPath = await createTestDir("desktop-git-spawn-empty");
		await gitExec(["init"], testRepoPath);

		// write this file in two parts to ensure we don't trip the string length limits
		const filePath = join(testRepoPath, "file.txt");

		const pointInTime = 100_000_000;
		const firstBufferLength = maximumStringSize - pointInTime;
		const secondBufferLength = pointInTime;

		const firstBuffer = Buffer.alloc(firstBufferLength);
		firstBuffer.fill("a");
		const secondBuffer = Buffer.alloc(secondBufferLength);
		secondBuffer.fill("b");

		await appendFile(filePath, firstBuffer);
		await appendFile(filePath, secondBuffer);

		const subprocess = spawn(
			["diff", "--no-index", "--patch-with-raw", "-z", "--", "/dev/null", "file.txt"],
			testRepoPath,
			testContext,
		);

		await expect(bufferOutput(subprocess)).rejects.toThrow("string size");
	}, 120_000);
});
