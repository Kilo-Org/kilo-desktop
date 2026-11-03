import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DomainHandle } from "@kilo-desktop/kernel";
import type { Authorization, Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import { createTerminalCwdResolver } from "./cwd";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function tempRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), prefix));
	directories.push(root);
	return root;
}

function workspacesAuthorizing(decide: (target: string) => Authorization) {
	const authorize = vi.fn(async ({ path: target }: { path: string; rule: string }) =>
		decide(target),
	);
	const handle = { methods: { authorize } } as unknown as DomainHandle<typeof Workspaces>;
	return { handle, authorize };
}

describe("terminal cwd resolution", () => {
	it("uses the user home directory, symlinks resolved, when no folder is asked for", async () => {
		const root = await tempRoot("terminal-home-");
		const home = path.join(root, "home");
		const alias = path.join(root, "home-alias");
		await mkdir(home);
		await symlink(home, alias);

		await expect(createTerminalCwdResolver(() => null, alias)()).resolves.toBe(
			await realpath(home),
		);
	});

	it("refuses a home directory that doesn't exist", async () => {
		const root = await tempRoot("terminal-home-");

		await expect(
			createTerminalCwdResolver(() => null, path.join(root, "gone"))(),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("asks kilo.workspaces whether the canonical folder is a primary folder or its worktree", async () => {
		const root = await tempRoot("terminal-auth-");
		const primary = path.join(root, "primary");
		const alias = path.join(root, "alias");
		await mkdir(primary);
		await symlink(primary, alias);
		const canonical = await realpath(primary);
		const { handle, authorize } = workspacesAuthorizing((target) =>
			target === canonical
				? { allowed: true, workspaceId: "w", folder: canonical, path: canonical }
				: { allowed: false },
		);

		await expect(createTerminalCwdResolver(() => handle)(alias)).resolves.toBe(canonical);
		expect(authorize).toHaveBeenCalledWith({ path: canonical, rule: "primary" });
	});

	it("refuses folders kilo.workspaces doesn't authorise, and ones that don't exist", async () => {
		const root = await tempRoot("terminal-auth-");
		const { handle } = workspacesAuthorizing(() => ({ allowed: false }));
		const resolve = createTerminalCwdResolver(() => handle);

		await expect(resolve(root)).rejects.toMatchObject({
			code: "VALIDATION",
			message: "Terminal cwd is not a registered primary workspace.",
		});
		await expect(resolve(path.join(root, "missing"))).rejects.toMatchObject({
			code: "VALIDATION",
			message: "The terminal workspace does not exist.",
		});
	});

	it("fails closed when workspaces aren't available", async () => {
		await expect(createTerminalCwdResolver(() => null)(os.tmpdir())).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
	});
});
