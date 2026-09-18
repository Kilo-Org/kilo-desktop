import type { IpcHandlers } from "@kilo-desktop/contracts";

import type { ScopedFsService } from "../../platform/ScopedFsService.js";

type FsChannels = Pick<
	IpcHandlers,
	"fs:read-file" | "fs:write-file" | "fs:exists" | "fs:mkdir" | "fs:readdir" | "fs:remove"
>;

export function createFsHandlers(fs: ScopedFsService): FsChannels {
	return {
		"fs:read-file": async ({ featureId, path }) => ({
			content: await fs.readFile(featureId, path),
		}),
		"fs:write-file": async ({ featureId, path, content }) => {
			await fs.writeFile(featureId, path, content);
		},
		"fs:exists": async ({ featureId, path }) => ({ exists: await fs.exists(featureId, path) }),
		"fs:mkdir": async ({ featureId, path }) => {
			await fs.mkdir(featureId, path);
		},
		"fs:readdir": async ({ featureId, path }) => ({
			entries: await fs.readdir(featureId, path),
		}),
		"fs:remove": async ({ featureId, path }) => {
			await fs.remove(featureId, path);
		},
	} satisfies FsChannels;
}
