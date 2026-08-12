import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimedArtifact } from "./artifacts.js";
import { isNativeExecutable, stageRuntimed } from "./stage-runtimed.js";

const directories: string[] = [];
const ELF_BYTES = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 4]);

function artifactFor(bytes: Buffer = ELF_BYTES): RuntimedArtifact {
	return {
		target: "linux-x64-test",
		platform: "linux",
		arch: "x64",
		assetName: "runtimed-nightly-linux-x64-test",
		executable: "runtimed-nightly",
		bytes: bytes.byteLength,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "runtimed-stage-"));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("stageRuntimed", () => {
	it("downloads, verifies, and stages an executable atomically", async () => {
		const resourceRoot = await temporaryDirectory();
		const fetch_ = vi.fn(async () => new Response(ELF_BYTES));

		const result = await stageRuntimed({
			resourceRoot,
			artifact: artifactFor(),
			fetch: fetch_ as typeof fetch,
		});

		expect(result.staged).toBe(true);
		expect(await readFile(result.executablePath)).toEqual(ELF_BYTES);
		expect((await stat(result.executablePath)).mode & 0o111).toBe(0o111);
		expect(
			JSON.parse(await readFile(path.join(result.targetDirectory, "staged.json"), "utf8")),
		).toMatchObject({
			schemaVersion: 1,
			target: "linux-x64-test",
		});
		expect(fetch_).toHaveBeenCalledOnce();
		expect(fetch_).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ redirect: "follow", signal: expect.any(AbortSignal) }),
		);
	});

	it("restages a cached Unix binary whose executable permission was lost", async () => {
		const resourceRoot = await temporaryDirectory();
		const fetch_ = vi.fn(async () => new Response(ELF_BYTES));
		const options = { resourceRoot, artifact: artifactFor(), fetch: fetch_ as typeof fetch };
		const first = await stageRuntimed(options);
		await chmod(first.executablePath, 0o644);

		await expect(stageRuntimed(options)).resolves.toMatchObject({ staged: true });
		expect((await stat(first.executablePath)).mode & 0o111).not.toBe(0);
		expect(fetch_).toHaveBeenCalledTimes(2);
	});

	it("reuses a verified current stage without downloading again", async () => {
		const resourceRoot = await temporaryDirectory();
		const fetch_ = vi.fn(async () => new Response(ELF_BYTES));
		const options = { resourceRoot, artifact: artifactFor(), fetch: fetch_ as typeof fetch };

		await stageRuntimed(options);
		await expect(stageRuntimed(options)).resolves.toMatchObject({ staged: false });
		expect(fetch_).toHaveBeenCalledOnce();
	});

	it("replaces a corrupted cached executable", async () => {
		const resourceRoot = await temporaryDirectory();
		const fetch_ = vi.fn(async () => new Response(ELF_BYTES));
		const first = await stageRuntimed({
			resourceRoot,
			artifact: artifactFor(),
			fetch: fetch_ as typeof fetch,
		});
		await writeFile(first.executablePath, "corrupt");

		await expect(
			stageRuntimed({ resourceRoot, artifact: artifactFor(), fetch: fetch_ as typeof fetch }),
		).resolves.toMatchObject({ staged: true });
		expect(await readFile(first.executablePath)).toEqual(ELF_BYTES);
		expect(fetch_).toHaveBeenCalledTimes(2);
	});

	it("rejects HTTP, size, digest, and native-format failures", async () => {
		const root = await temporaryDirectory();
		await expect(
			stageRuntimed({
				resourceRoot: root,
				artifact: artifactFor(),
				fetch: (async () => new Response(null, { status: 503 })) as typeof fetch,
			}),
		).rejects.toThrow(/HTTP 503/);

		await expect(
			stageRuntimed({
				resourceRoot: root,
				artifact: { ...artifactFor(), bytes: ELF_BYTES.length + 1 },
				fetch: (async () => new Response(ELF_BYTES)) as typeof fetch,
			}),
		).rejects.toThrow(/size mismatch/);

		await expect(
			stageRuntimed({
				resourceRoot: root,
				artifact: { ...artifactFor(), sha256: "0".repeat(64) },
				fetch: (async () => new Response(ELF_BYTES)) as typeof fetch,
			}),
		).rejects.toThrow(/SHA-256 mismatch/);

		const text = Buffer.from("not-bin!");
		await expect(
			stageRuntimed({
				resourceRoot: root,
				artifact: artifactFor(text),
				fetch: (async () => new Response(text)) as typeof fetch,
			}),
		).rejects.toThrow(/not a native linux executable/);
	});

	it("aborts a stalled download", async () => {
		const fetch_ = vi.fn(
			async (_url: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
				}),
		);
		await expect(
			stageRuntimed({
				resourceRoot: await temporaryDirectory(),
				artifact: artifactFor(),
				fetch: fetch_ as typeof fetch,
				timeoutMs: 1,
			}),
		).rejects.toThrow(/aborted/);
	});
});

describe("isNativeExecutable", () => {
	it("recognizes ELF, PE, and Mach-O magic", async () => {
		const directory = await temporaryDirectory();
		const file = path.join(directory, "binary");
		await writeFile(file, ELF_BYTES);
		await expect(isNativeExecutable(file, "linux")).resolves.toBe(true);

		await writeFile(file, Buffer.from([0x4d, 0x5a, 0, 0]));
		await expect(isNativeExecutable(file, "win32")).resolves.toBe(true);

		await writeFile(file, Buffer.from([0xfe, 0xed, 0xfa, 0xcf]));
		await expect(isNativeExecutable(file, "darwin")).resolves.toBe(true);
	});
});
