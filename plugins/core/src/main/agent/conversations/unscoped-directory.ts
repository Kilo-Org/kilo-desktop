import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";

/**
 * A new folder for a chat started outside any workspace, under the app's
 * `chats` folder beside the plugins' storage (where origin kept them), so the
 * chat's files outlive the app's temporary folders.
 */
export async function createUnscopedChatDirectory(storageDir: string): Promise<string> {
	const chatsDirectory = path.resolve(storageDir, "../..", "chats");
	await mkdir(chatsDirectory, { recursive: true });
	return mkdtemp(path.join(chatsDirectory, "session-"));
}
