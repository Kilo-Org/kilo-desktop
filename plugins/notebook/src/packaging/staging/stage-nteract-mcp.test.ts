import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BundledNativeExecutable, NteractMcpArtifact, ReleaseAsset } from "../artifacts.js";
import { stageNteractMcp } from "./stage-nteract-mcp.js";

const directories: string[] = [];
const MCP_BYTES = Buffer.from([0xfe, 0xed, 0xfa, 0xcf, 1, 2, 3, 4]);
const RUNT_BYTES = Buffer.from([0xfe, 0xed, 0xfa, 0xcf, 5, 6, 7, 8]);
const ARCHIVE_BYTES = Buffer.from("signed upstream app archive");

function digest(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function bundledBinary(
	executable: string,
	bytes: Buffer,
	source: ReleaseAsset,
	entryPath: string,
): BundledNativeExecutable {
	return {
		executable,
		bytes: bytes.byteLength,
		sha256: digest(bytes),
		source,
		extraction: { kind: "tar-gz", entryPath },
	};
}

function artifactFor(): NteractMcpArtifact {
	const source = {
		assetName: "nteract-test.app.tar.gz",
		bytes: ARCHIVE_BYTES.byteLength,
		sha256: digest(ARCHIVE_BYTES),
	};
	return {
		target: "darwin-arm64-test",
		platform: "darwin",
		arch: "arm64",
		nteractMcp: bundledBinary("nteract-mcp", MCP_BYTES, source, "app/nteract-mcp"),
		runt: bundledBinary("runt-nightly", RUNT_BYTES, source, "app/runt"),
	};
}

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "nteract-mcp-stage-"));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("stageNteractMcp", () => {
	it("downloads a shared upstream bundle once and stages verified colocated executables", async () => {
		const resourceRoot = await temporaryDirectory();
		const artifact = artifactFor();
		const fetch_ = vi.fn(async () => new Response(ARCHIVE_BYTES));
		const extract = vi.fn(
			async (_sourcePath: string, binary: BundledNativeExecutable): Promise<Buffer> =>
				binary.executable === "nteract-mcp" ? MCP_BYTES : RUNT_BYTES,
		);

		const result = await stageNteractMcp({
			resourceRoot,
			artifact,
			fetch: fetch_ as typeof fetch,
			extract,
		});

		expect(result.staged).toBe(true);
		expect(fetch_).toHaveBeenCalledOnce();
		expect(extract).toHaveBeenCalledTimes(2);
		expect(await readFile(result.nteractMcpPath)).toEqual(MCP_BYTES);
		expect(await readFile(result.runtPath)).toEqual(RUNT_BYTES);
		expect((await stat(result.nteractMcpPath)).mode & 0o111).not.toBe(0);
		expect((await stat(result.runtPath)).mode & 0o111).not.toBe(0);
		expect(await readFile(path.join(result.targetDirectory, "staged.json"), "utf8")).toContain(
			artifact.nteractMcp.sha256,
		);

		const current = await stageNteractMcp({
			resourceRoot,
			artifact,
			fetch: fetch_ as typeof fetch,
			extract,
		});
		expect(current.staged).toBe(false);
		expect(fetch_).toHaveBeenCalledOnce();
	});
});
