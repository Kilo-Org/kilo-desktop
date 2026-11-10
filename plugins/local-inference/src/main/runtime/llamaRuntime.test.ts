import { describe, expect, it, vi } from "vitest";

import { resolveLlamaExecutable, type LlamaRuntimeCandidate } from "./llamaRuntime";

function runtime(title: string, resolve: () => Promise<string>): LlamaRuntimeCandidate {
	return { title, resolveExecutable: vi.fn(resolve) };
}

describe("resolveLlamaExecutable", () => {
	it("uses LOCAL_LLAMA_SERVER_PATH when it is readable", async () => {
		const conda = runtime("Conda", async () => "/unused/llama-server");
		await expect(
			resolveLlamaExecutable({
				runtimes: [conda],
				overridePath: "/opt/llama-server",
				accessFile: async () => {},
			}),
		).resolves.toBe("/opt/llama-server");
		expect(conda.resolveExecutable).not.toHaveBeenCalled();
	});

	it("rejects when LOCAL_LLAMA_SERVER_PATH is not readable", async () => {
		await expect(
			resolveLlamaExecutable({
				runtimes: [],
				overridePath: " /opt/missing ",
				accessFile: async (filePath) => {
					throw new Error(`ENOENT ${filePath}`);
				},
			}),
		).rejects.toThrow("ENOENT /opt/missing");
	});

	it("throws when no llama-runtime is contributed", async () => {
		await expect(resolveLlamaExecutable({ runtimes: [] })).rejects.toThrow(
			"The local inference runtime is unavailable.",
		);
	});

	it("tries runtimes in priority order and uses the first that resolves", async () => {
		const warnings: string[] = [];
		const first = runtime("First", async () => {
			throw new Error("CUDA build unavailable");
		});
		const second = runtime("Second", async () => "/second/llama-server");
		const third = runtime("Third", async () => "/third/llama-server");
		await expect(
			resolveLlamaExecutable({
				runtimes: [first, second, third],
				accessFile: async () => {},
				logger: { warn: (message) => warnings.push(message) },
			}),
		).resolves.toBe("/second/llama-server");
		expect(third.resolveExecutable).not.toHaveBeenCalled();
		expect(warnings).toEqual(["Could not get llama.cpp from First: CUDA build unavailable"]);
	});

	it("falls back when a runtime's binary is missing", async () => {
		await expect(
			resolveLlamaExecutable({
				runtimes: [
					runtime("CUDA", async () => "/cuda-env/llama-server"),
					runtime("CPU", async () => "/cpu-env/llama-server"),
				],
				accessFile: async (filePath) => {
					if (filePath.startsWith("/cuda-env")) throw new Error("missing binary");
				},
			}),
		).resolves.toBe("/cpu-env/llama-server");
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
				accessFile: async () => {},
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
				accessFile: async () => {},
				logger: { warn: (message) => warnings.push(message) },
			}),
		).rejects.toThrow("Local inference could not install llama.cpp.");
		expect(warnings.some((message) => message.includes("conda missing"))).toBe(true);
	});
});
