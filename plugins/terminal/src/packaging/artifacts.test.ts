import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validateTerminalBundle } from "./artifacts.js";

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
