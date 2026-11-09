import { access, chmod, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const TERMINAL_BUNDLE_FILES = ["index.html", "ghostty-vt.wasm"] as const;

export async function validateTerminalBundle(root: string): Promise<void> {
	await Promise.all(TERMINAL_BUNDLE_FILES.map((file) => access(path.join(root, file))));
	const assets = path.join(root, "assets");
	const assetFiles = await readdir(assets);
	if (!assetFiles.some((file) => file.endsWith(".js"))) {
		throw new Error("The terminal bundle has no JavaScript entry asset.");
	}
}

export async function ensureNodePtySpawnHelpersExecutable(
	packageDirectory: string,
	platform: string,
	arch: string,
): Promise<void> {
	if (platform !== "darwin" && platform !== "mas") return;

	const candidates = [
		path.join(packageDirectory, "build", "Release", "spawn-helper"),
		path.join(packageDirectory, "build", "Debug", "spawn-helper"),
		path.join(packageDirectory, "prebuilds", `darwin-${arch}`, "spawn-helper"),
	];
	let found = false;
	for (const candidate of candidates) {
		try {
			const metadata = await stat(candidate);
			await chmod(candidate, metadata.mode | 0o111);
			found = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	if (!found) {
		throw new Error(`node-pty spawn-helper is missing from ${packageDirectory}`);
	}
}
