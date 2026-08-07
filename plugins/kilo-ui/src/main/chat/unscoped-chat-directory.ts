import { mkdir } from "node:fs/promises";
import path from "node:path";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk/main";

/**
 * App-level userData root from a plugin storageDir (`${userData}/plugins/<id>/`).
 */
export function userDataRoot(storageDir: string): string {
	return path.resolve(storageDir, "../..");
}

/** Per-chat directory for an unscoped chat: `{userData}/chats/<chatId>/`. */
export function unscopedChatDirectory(userData: string, chatId: string): string {
	const chatsRoot = path.resolve(userData, "chats");
	const directory = path.resolve(chatsRoot, chatId);
	const relative = path.relative(chatsRoot, directory);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new FeatureError("Invalid chat id.", "VALIDATION");
	}
	return directory;
}

export async function ensureUnscopedChatDirectory(
	storageDir: string,
	chatId: string,
): Promise<string> {
	const directory = unscopedChatDirectory(userDataRoot(storageDir), chatId);
	await mkdir(directory, { recursive: true });
	return directory;
}
