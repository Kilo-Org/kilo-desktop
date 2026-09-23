import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { KILO_CLI_VERSION, type KiloCliArtifact } from "./artifacts.js";
import { stageKiloCli } from "./stage.js";

const temporaryDirectories: string[] = [];

const artifact: KiloCliArtifact = {
	target: "test-target",
	packageName: "@kilocode/cli-test",
	platform: "linux",
	arch: "x64",
	executable: "kilo",
};

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
	);
});

async function createInstalledPackage(): Promise<{ root: string; packageDirectory: string }> {
	const root = await mkdtemp(path.join(os.tmpdir(), "kilo-cli-stage-test-"));
	temporaryDirectories.push(root);
	const packageDirectory = path.join(root, "package");
	await mkdir(path.join(packageDirectory, "bin", "tree-sitter"), { recursive: true });
	await writeFile(
		path.join(packageDirectory, "package.json"),
		JSON.stringify({ version: KILO_CLI_VERSION }),
	);
	await writeFile(path.join(packageDirectory, "bin", "kilo"), "binary");
	await writeFile(path.join(packageDirectory, "bin", "tree-sitter", "tree-sitter.wasm"), "wasm");
	return { root, packageDirectory };
}

async function permissionBits(filePath: string): Promise<number> {
	return (await stat(filePath)).mode & 0o777;
}

describe("stageKiloCli", () => {
	it("copies an installed native package into executable resources", async () => {
		const { root, packageDirectory } = await createInstalledPackage();
		const resourceRoot = path.join(root, "resources");

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

	// Linux packages install resources as root for a different runtime user, so
	// the staged target directory must be traversable by everyone.
	it.skipIf(process.platform === "win32")(
		"stages a target directory readable by users other than the builder",
		async () => {
			const { root, packageDirectory } = await createInstalledPackage();
			const resourceRoot = path.join(root, "resources");

			const result = await stageKiloCli({ resourceRoot, artifact, packageDirectory });

			expect(await permissionBits(result.targetDirectory)).toBe(0o755);
		},
	);

	it.skipIf(process.platform === "win32")(
		"repairs an already-current stage restored with an owner-only directory",
		async () => {
			const { root, packageDirectory } = await createInstalledPackage();
			const resourceRoot = path.join(root, "resources");
			const first = await stageKiloCli({ resourceRoot, artifact, packageDirectory });
			await chmod(first.targetDirectory, 0o700);

			const result = await stageKiloCli({ resourceRoot, artifact, packageDirectory });

			expect(result.staged).toBe(false);
			expect(await permissionBits(result.targetDirectory)).toBe(0o755);
		},
	);
});
