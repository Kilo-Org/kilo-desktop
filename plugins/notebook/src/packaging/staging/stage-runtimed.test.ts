import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimedArtifact } from "../artifacts";
import { stageRuntimed } from "./stage-runtimed";

const directories: string[] = [];
const MACHO_BYTES = Buffer.from([0xfe, 0xed, 0xfa, 0xcf, 1, 2, 3, 4]);

function artifactFor(bytes: Buffer = MACHO_BYTES): RuntimedArtifact {
	return {
		target: "darwin-arm64-test",
		platform: "darwin",
		arch: "arm64",
		assetName: "runtimed-nightly-darwin-arm64-test",
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
	it("stages an executable daemon with a verified manifest", async () => {
		const resourceRoot = await temporaryDirectory();
		const fetch_ = vi.fn(async () => new Response(MACHO_BYTES));
		const result = await stageRuntimed({
			resourceRoot,
			artifact: artifactFor(),
			fetch: fetch_ as typeof fetch,
		});

		expect(result.staged).toBe(true);
		expect(await readFile(result.executablePath)).toEqual(MACHO_BYTES);
		expect((await stat(result.executablePath)).isFile()).toBe(true);
		if (process.platform !== "win32") {
			expect((await stat(result.executablePath)).mode & 0o111).not.toBe(0);
		}
		expect(await readFile(path.join(result.targetDirectory, "staged.json"), "utf8")).toContain(
			result.artifact.sha256,
		);
	});

	// Linux packages install resources as root for a different runtime user, so
	// the staged target directory must be traversable by everyone.
	it.skipIf(process.platform === "win32")(
		"stages a target directory readable by users other than the builder",
		async () => {
			const resourceRoot = await temporaryDirectory();
			const fetch_ = vi.fn(async () => new Response(MACHO_BYTES));

			const result = await stageRuntimed({
				resourceRoot,
				artifact: artifactFor(),
				fetch: fetch_ as typeof fetch,
			});

			expect((await stat(result.targetDirectory)).mode & 0o777).toBe(0o755);
		},
	);

	it.skipIf(process.platform === "win32")(
		"repairs an already-current stage restored with an owner-only directory",
		async () => {
			const resourceRoot = await temporaryDirectory();
			const fetch_ = vi.fn(async () => new Response(MACHO_BYTES));
			const options = { resourceRoot, artifact: artifactFor(), fetch: fetch_ as typeof fetch };
			const first = await stageRuntimed(options);
			await chmod(first.targetDirectory, 0o700);

			const result = await stageRuntimed(options);

			expect(result.staged).toBe(false);
			expect((await stat(result.targetDirectory)).mode & 0o777).toBe(0o755);
		},
	);
});
