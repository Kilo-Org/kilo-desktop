import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureNodePtySpawnHelpersExecutable, validateTerminalBundle } from "./artifacts.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("terminal bundle artifacts", () => {
	it("requires HTML, JavaScript assets, and the ghostty WASM", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "terminal-bundle-"));
		directories.push(root);
		await mkdir(path.join(root, "assets"));
		await writeFile(path.join(root, "index.html"), "<script src='./assets/index.js'></script>");
		await writeFile(path.join(root, "assets", "index.js"), "export {};");
		await writeFile(path.join(root, "ghostty-vt.wasm"), "wasm");
		await expect(validateTerminalBundle(root)).resolves.toBeUndefined();
		await rm(path.join(root, "ghostty-vt.wasm"));
		await expect(validateTerminalBundle(root)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects a bundle without a JavaScript entry asset", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "terminal-bundle-"));
		directories.push(root);
		await mkdir(path.join(root, "assets"));
		await writeFile(path.join(root, "index.html"), "<html></html>");
		await writeFile(path.join(root, "assets", "styles.css"), "body {}");
		await writeFile(path.join(root, "ghostty-vt.wasm"), "wasm");
		await expect(validateTerminalBundle(root)).rejects.toThrow(
			"The terminal bundle has no JavaScript entry asset.",
		);
	});
});

describe("node-pty packaging artifacts", () => {
	it.skipIf(process.platform === "win32")(
		"makes the native rebuild's macOS spawn helper executable before ASAR packaging",
		async () => {
			const packageDirectory = await mkdtemp(path.join(os.tmpdir(), "terminal-node-pty-"));
			directories.push(packageDirectory);
			const releaseDirectory = path.join(packageDirectory, "build/Release");
			const spawnHelper = path.join(releaseDirectory, "spawn-helper");
			await mkdir(releaseDirectory, { recursive: true });
			await writeFile(spawnHelper, "helper");
			await chmod(spawnHelper, 0o644);

			await ensureNodePtySpawnHelpersExecutable(packageDirectory, "darwin", "arm64");

			expect((await stat(spawnHelper)).mode & 0o111).toBe(0o111);
		},
	);

	it("fails macOS packaging when node-pty has no spawn helper", async () => {
		const packageDirectory = await mkdtemp(path.join(os.tmpdir(), "terminal-node-pty-"));
		directories.push(packageDirectory);

		await expect(
			ensureNodePtySpawnHelpersExecutable(packageDirectory, "darwin", "arm64"),
		).rejects.toThrow("node-pty spawn-helper is missing");
	});
});
