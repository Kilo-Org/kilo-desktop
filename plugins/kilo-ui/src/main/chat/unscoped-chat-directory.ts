import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";

export async function createUnscopedChatDirectory(storageDir: string): Promise<string> {
	const chatsDirectory = path.resolve(storageDir, "../..", "chats");
	await mkdir(chatsDirectory, { recursive: true });
	return mkdtemp(path.join(chatsDirectory, "session-"));
}
