import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const PARTIAL_SUFFIX = ".importing";

async function exists(file: string): Promise<boolean> {
	try {
		await stat(file);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

/**
 * Copies origin's saved terminal transcripts (`<origin>/history/*.log`) into
 * this plugin's storage, never overwriting one written since. Each copy goes
 * to a `.importing` file first and is renamed into place, so a crash leaves
 * no partial transcript behind; the next attempt copies that file afresh. A
 * missing origin folder means there is nothing to import.
 */
export async function importOriginHistory(originDir: string, storageDir: string): Promise<void> {
	const from = path.join(originDir, "history");
	const to = path.join(storageDir, "history");
	let entries;
	try {
		entries = await readdir(from, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	await mkdir(to, { recursive: true });
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const target = path.join(to, entry.name);
		const partial = `${target}${PARTIAL_SUFFIX}`;
		if (await exists(target)) {
			await rm(partial, { force: true });
			continue;
		}
		await copyFile(path.join(from, entry.name), partial);
		await rename(partial, target);
	}
}
