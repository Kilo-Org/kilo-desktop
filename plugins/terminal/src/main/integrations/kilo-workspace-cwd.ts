import { realpath } from "node:fs/promises";
import { homedir } from "node:os";

import { FeatureError, type MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

interface WorkspaceCapability extends Record<string, unknown> {
	workspaceService: {
		list(): Promise<readonly { folders: readonly { path: string; isPrimary: boolean }[] }[]>;
	};
}

function comparable(value: string): string {
	return process.platform === "win32" ? value.toLocaleLowerCase() : value;
}

export function createTerminalCwdResolver(
	mainSdk: MainSdk,
	homeDirectory = homedir(),
): (cwd?: string) => Promise<string> {
	return async (cwd) => {
		if (cwd === undefined) {
			try {
				return await realpath(homeDirectory);
			} catch {
				throw new FeatureError("The user home directory does not exist.", "VALIDATION");
			}
		}
		const service = mainSdk.plugins.get<WorkspaceCapability>("kilo-ui")?.workspaceService;
		if (!service) throw new FeatureError("Kilo workspace service is unavailable.", "BUSINESS");
		let canonical: string;
		try {
			canonical = await realpath(cwd);
		} catch {
			throw new FeatureError("The terminal workspace does not exist.", "VALIDATION");
		}
		const workspaces = await service.list();
		for (const folder of workspaces.flatMap(({ folders }) =>
			folders.filter(({ isPrimary }) => isPrimary),
		)) {
			try {
				if (comparable(await realpath(folder.path)) === comparable(canonical)) return canonical;
			} catch {
				// Stale workspace folders are ignored; the requested folder still has to match another primary.
			}
		}
		throw new FeatureError("Terminal cwd is not a registered primary workspace.", "VALIDATION");
	};
}
