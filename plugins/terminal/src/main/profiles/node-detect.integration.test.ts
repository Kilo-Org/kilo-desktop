import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createNodeDetectFs, nodeExecFile } from "./node-detect";

const directories: string[] = [];

async function tempDir() {
	const directory = await mkdtemp(path.join(os.tmpdir(), "terminal-detect-"));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe.skipIf(process.platform === "win32")("Node detection file system (POSIX)", () => {
	const fs = createNodeDetectFs(process.platform);

	it("treats only executable files, through symlinks, as launchable", async () => {
		const directory = await tempDir();
		const shell = path.join(directory, "shell");
		const plain = path.join(directory, "plain");
		const folder = path.join(directory, "folder");
		await writeFile(shell, "#!/bin/sh\n");
		await chmod(shell, 0o755);
		await writeFile(plain, "text");
		await chmod(plain, 0o644);
		await mkdir(folder);
		await symlink(shell, path.join(directory, "link"));
		await symlink(path.join(directory, "gone"), path.join(directory, "dangling"));

		expect(await fs.isExecutableFile(shell)).toBe(true);
		expect(await fs.isExecutableFile(path.join(directory, "link"))).toBe(true);
		expect(await fs.isExecutableFile(plain)).toBe(false);
		expect(await fs.isExecutableFile(folder)).toBe(false);
		expect(await fs.isExecutableFile(path.join(directory, "dangling"))).toBe(false);
		expect(await fs.isDirectory(folder)).toBe(true);
		expect(await fs.isDirectory(shell)).toBe(false);
		expect(await fs.isDirectory(path.join(directory, "missing"))).toBe(false);
		expect(await fs.readdir(directory)).toEqual(
			expect.arrayContaining(["shell", "plain", "folder"]),
		);
		expect(await fs.readFile(plain)).toBe("text");
	});

	it("runs a program without a shell and returns its output", async () => {
		const output = await nodeExecFile("/bin/echo", ["$HOME"], { timeout: 5_000, env: {} });
		expect(output.toString().trim()).toBe("$HOME");
		await expect(
			nodeExecFile("/nonexistent/program", [], { timeout: 5_000, env: {} }),
		).rejects.toThrow();
	});
});
