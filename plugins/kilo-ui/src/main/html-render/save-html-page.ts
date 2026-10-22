import { realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { FeatureError } from "@kilo-desktop/feature-sdk/main";

import { htmlPageFileStem } from "../../contracts/html-render/schemas.js";
import type { KiloUiChatService } from "../../contracts/chat/schemas.js";

/** Kilo-managed chat worktrees live directly under `<registered>/.kilo/worktrees/`. */
const KILO_WORKTREE_SEGMENTS = [".kilo", "worktrees"] as const;
/** Name attempts before giving up: `Chart.html`, `Chart 2.html`, … */
const MAX_NAME_ATTEMPTS = 100;

function comparablePath(value: string): string {
	return process.platform === "win32" ? value.toLocaleLowerCase() : value;
}

async function canonicalOrNull(path: string): Promise<string | null> {
	try {
		return comparablePath(await realpath(path));
	} catch {
		return null;
	}
}

/**
 * The canonical directory to save into, accepted only when it is a registered
 * workspace folder or a managed chat worktree of one. The renderer names the
 * directory, so it is never trusted as given.
 */
async function authorizedWorkspaceRoot(
	workspaceDirectory: string,
	registeredFolders: readonly string[],
): Promise<string> {
	const canonical = await canonicalOrNull(workspaceDirectory);
	if (!canonical || !(await stat(canonical)).isDirectory()) {
		throw new FeatureError("Workspace folder not found.", "NOT_FOUND");
	}
	const registered = await Promise.all(registeredFolders.map(canonicalOrNull));
	const allowed = registered.some(
		(folder) =>
			folder !== null &&
			(folder === canonical || dirname(canonical) === resolve(folder, ...KILO_WORKTREE_SEGMENTS)),
	);
	if (!allowed) {
		throw new FeatureError("Workspace folder is not registered.", "VALIDATION");
	}
	return canonical;
}

function isAlreadyExists(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
}

/**
 * `chat.saveHtmlPage`: writes the page next to the workspace's other files.
 * Exclusive create (`wx`) means an existing file — or a symlink planted in
 * its place — is never written through; the name just moves on.
 */
export function createSaveHtmlPageHandler(
	registeredFolders: () => readonly string[],
): KiloUiChatService["chat.saveHtmlPage"] {
	return async ({ workspaceDirectory, title, html }) => {
		const root = await authorizedWorkspaceRoot(workspaceDirectory, registeredFolders());
		const stem = htmlPageFileStem(title);
		for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
			const name = attempt === 1 ? `${stem}.html` : `${stem} ${attempt}.html`;
			try {
				await writeFile(join(root, name), html, { encoding: "utf8", flag: "wx" });
				return { relativePath: name };
			} catch (error) {
				if (!isAlreadyExists(error)) throw error;
			}
		}
		throw new FeatureError(`Too many files named "${stem}" already exist.`, "BUSINESS");
	};
}
