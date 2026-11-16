import { realpath } from "node:fs/promises";
import { homedir } from "node:os";

import { KernelError, type DomainObjectHandle } from "@kilo-desktop/kernel";
import type { Workspaces } from "@kilo-desktop/plugin-work-sessions/contracts";

/**
 * Where a terminal may start: the home directory when no folder is asked
 * for, otherwise a workspace's primary folder or one of its managed
 * worktrees, as kilo.work-sessions authorises it. Fails closed when workspaces
 * can't be consulted.
 */
export function createTerminalCwdResolver(
	workspaces: () => DomainObjectHandle<typeof Workspaces> | null,
	homeDirectory = homedir(),
): (cwd?: string) => Promise<string> {
	return async (cwd) => {
		if (cwd === undefined) {
			try {
				return await realpath(homeDirectory);
			} catch {
				throw new KernelError("VALIDATION", "The user home directory does not exist.");
			}
		}
		const handle = workspaces();
		if (!handle) throw new KernelError("UNAVAILABLE", "Workspaces aren't available.");
		let canonical: string;
		try {
			canonical = await realpath(cwd);
		} catch {
			throw new KernelError("VALIDATION", "The terminal workspace does not exist.");
		}
		const authorization = await handle.methods.authorize({ path: canonical, rule: "primary" });
		if (!authorization.allowed) {
			throw new KernelError("VALIDATION", "Terminal cwd is not a registered primary workspace.");
		}
		return authorization.path ?? canonical;
	};
}
