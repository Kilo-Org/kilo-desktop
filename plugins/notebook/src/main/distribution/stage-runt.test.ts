import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntArtifact } from "./artifacts.js";
import { stageRunt } from "./stage-runt.js";

const directories: string[] = [];
const MACHO_BYTES = Buffer.from([0xfe, 0xed, 0xfa, 0xcf, 1, 2, 3, 4]);

function artifactFor(bytes: Buffer = MACHO_BYTES): RuntArtifact {
	return {
		target: "darwin-arm64-test",
		platform: "darwin",
		arch: "arm64",
		assetName: "runt-nightly-darwin-arm64-test",
		executable: "runt-nightly",
		bytes: bytes.byteLength,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "runt-stage-"));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("stageRunt", () => {
	it("stages the CLI when an artifact is provided", async () => {
		const resourceRoot = await temporaryDirectory();
		const fetch_ = vi.fn(async () => new Response(MACHO_BYTES));
		const result = await stageRunt({
			resourceRoot,
			artifact: artifactFor(),
			fetch: fetch_ as typeof fetch,
		});
		expect(result?.staged).toBe(true);
		expect(await readFile(result!.executablePath)).toEqual(MACHO_BYTES);
		expect((await stat(result!.executablePath)).mode & 0o111).not.toBe(0);
	});
});
