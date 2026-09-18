import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { KILO_CLI_VERSION, type KiloCliArtifact } from "./artifacts.js";
import { stageKiloCli } from "./stage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
	);
});

describe("stageKiloCli", () => {
	it("copies an installed native package into executable resources", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "kilo-cli-stage-test-"));
		temporaryDirectories.push(root);
		const packageDirectory = path.join(root, "package");
		const resourceRoot = path.join(root, "resources");
		await mkdir(path.join(packageDirectory, "bin", "tree-sitter"), { recursive: true });
		await writeFile(
			path.join(packageDirectory, "package.json"),
			JSON.stringify({ version: KILO_CLI_VERSION }),
		);
		await writeFile(path.join(packageDirectory, "bin", "kilo"), "binary");
		await writeFile(path.join(packageDirectory, "bin", "tree-sitter", "tree-sitter.wasm"), "wasm");
		const artifact: KiloCliArtifact = {
			target: "test-target",
			packageName: "@kilocode/cli-test",
			platform: "linux",
			arch: "x64",
			executable: "kilo",
		};

		const result = await stageKiloCli({ resourceRoot, artifact, packageDirectory });

		expect(result.staged).toBe(true);
		expect(await readFile(path.join(result.targetDirectory, "bin", "kilo"), "utf8")).toBe("binary");
		expect(
			JSON.parse(await readFile(path.join(result.targetDirectory, "staged.json"), "utf8")),
		).toEqual({
			version: KILO_CLI_VERSION,
			packageName: artifact.packageName,
			target: artifact.target,
		});
	});
});
