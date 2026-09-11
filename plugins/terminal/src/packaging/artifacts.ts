import { access, readdir } from "node:fs/promises";
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
