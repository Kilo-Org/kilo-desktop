import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";
// Test-only import pinning the authorization predicate to git's managed
// worktree convention (the segments const is the convention's single
// source — if git ever changes it, this file fails to match reality).
import { KILO_WORKTREE_SEGMENTS } from "@kilo-desktop/plugin-git/contracts";

import { createKiloWorkspaceAuthorization } from "./kilo-workspace-authorization.js";

const directories: string[] = [];
const disposables: Array<() => void> = [];

afterEach(async () => {
	for (const dispose of disposables.splice(0).reverse()) {
		dispose();
	}
	await Promise.all(
		directories
			.splice(0)
			.map((directory) =>
				rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
			),
	);
});

async function boot() {
	const userData = await mkdtemp(path.join(os.tmpdir(), "files-authorization-"));
	directories.push(userData);
	await mkdir(path.join(userData, "Project"));
	// macOS temp dirs live behind a symlink; registered paths and the
	// candidates arrive canonical (realpath'd), as FilesService provides.
	const project = await realpath(path.join(userData, "Project"));
	const worktreesDir = path.join(project, ...KILO_WORKTREE_SEGMENTS);
	await mkdir(path.join(worktreesDir, "kilo-x"), { recursive: true });

	const harnessSdk = createFakeSdk({ featureId: "test-harness" });
	const mainSdk = createFakeMainSdk({ featureId: "files", services: harnessSdk.services });
	const kiloSdk = createFakeMainSdk({ featureId: "kilo-ui", services: harnessSdk.services });
	kiloSdk.plugins.expose("workspaceService", {
		list: async () => [{ folders: [{ path: project, isPrimary: true }] }],
	});
	disposables.push(
		() => harnessSdk.destroy(),
		() => kiloSdk.dispose(),
		() => mainSdk.dispose(),
	);

	return { authorization: createKiloWorkspaceAuthorization(mainSdk), project, worktreesDir };
}

describe("createKiloWorkspaceAuthorization", () => {
	it("allows an exactly registered folder", async () => {
		const { authorization, project } = await boot();

		await expect(authorization(project)).resolves.toBeUndefined();
	});

	it("allows a direct managed-worktree child of a registered folder", async () => {
		const { authorization, worktreesDir } = await boot();

		await expect(
			authorization(await realpath(path.join(worktreesDir, "kilo-x"))),
		).resolves.toBeUndefined();
	});

	it("rejects paths nested deeper than a direct worktree child", async () => {
		const { authorization, worktreesDir } = await boot();

		await expect(authorization(path.join(worktreesDir, "kilo-x", "nested"))).rejects.toMatchObject({
			code: "VALIDATION",
		});
	});

	it("rejects worktree-lookalike siblings of the managed directory", async () => {
		const { authorization, project } = await boot();
		await mkdir(path.join(project, ".kilo", "worktrees-evil", "kilo-x"), { recursive: true });

		await expect(
			authorization(await realpath(path.join(project, ".kilo", "worktrees-evil", "kilo-x"))),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("pins the managed directory to git's KILO_WORKTREE_SEGMENTS convention", async () => {
		const { authorization, project } = await boot();
		const candidate = path.join(project, ...KILO_WORKTREE_SEGMENTS, "kilo-x");
		const lookalike = path.join(
			project,
			KILO_WORKTREE_SEGMENTS[0],
			`${KILO_WORKTREE_SEGMENTS[1]}-evil`,
			"kilo-x",
		);
		await mkdir(lookalike, { recursive: true });

		await expect(authorization(await realpath(candidate))).resolves.toBeUndefined();
		await expect(authorization(await realpath(lookalike))).rejects.toMatchObject({
			code: "VALIDATION",
		});
	});

	it("rejects unregistered folders", async () => {
		const { authorization } = await boot();
		const tmp = await mkdtemp(path.join(os.tmpdir(), "unregistered-"));
		const outside = await realpath(tmp);
		directories.push(outside);

		await expect(authorization(outside)).rejects.toMatchObject({ code: "VALIDATION" });
	});
});
