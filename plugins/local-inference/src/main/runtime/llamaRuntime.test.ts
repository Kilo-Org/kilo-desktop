import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveLlamaExecutable, type LlamaRuntimeCandidate } from "./llamaRuntime";

function runtime(title: string, resolve: () => Promise<string>): LlamaRuntimeCandidate {
	return { title, resolveExecutable: vi.fn(resolve) };
}

const directories: string[] = [];

afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true });
});

async function executableFile(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "llama-runtime-"));
	directories.push(directory);
	const file = path.join(directory, "llama-server");
	await writeFile(file, "");
	return file;
}

describe("resolveLlamaExecutable", () => {
	it("rejects when LOCAL_LLAMA_SERVER_PATH is not readable", async () => {
		await expect(
			resolveLlamaExecutable({
				runtimes: [],
				overridePath: " /opt/missing/llama-server ",
			}),
		).rejects.toThrow(/ENOENT.*\/opt\/missing\/llama-server/);
	});

	it("falls back when a runtime's binary is missing", async () => {
		const cpu = await executableFile();
		await expect(
			resolveLlamaExecutable({
				runtimes: [
					runtime("CUDA", async () => "/cuda-env/llama-server"),
					runtime("CPU", async () => cpu),
				],
			}),
		).resolves.toBe(cpu);
	});

	it("warns for each failure and throws the last error when every runtime fails", async () => {
		const warnings: string[] = [];
		await expect(
			resolveLlamaExecutable({
				runtimes: [
					runtime("First", async () => {
						throw new Error("failed first");
					}),
					runtime("Last", async () => {
						throw new Error("failed last");
					}),
				],
				logger: { warn: (message) => warnings.push(message) },
			}),
		).rejects.toThrow("failed last");
		expect(warnings).toEqual([
			"Could not get llama.cpp from First: failed first",
			"Could not get llama.cpp from Last: failed last",
		]);
	});

	it("wraps non-Error failures after every runtime fails", async () => {
		const warnings: string[] = [];
		await expect(
			resolveLlamaExecutable({
				runtimes: [
					runtime("Conda", async () => {
						throw "conda missing";
					}),
				],
				logger: { warn: (message) => warnings.push(message) },
			}),
		).rejects.toThrow("Local inference could not install llama.cpp.");
		expect(warnings.some((message) => message.includes("conda missing"))).toBe(true);
	});
});
