import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";

import { createTerminalCwdResolver } from "./kilo-workspace-cwd.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("terminal cwd resolution", () => {
	it("uses the user home directory when no workspace is provided", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "terminal-home-"));
		const home = path.join(root, "home");
		const alias = path.join(root, "home-alias");
		await mkdir(home);
		await symlink(home, alias);
		directories.push(root);

		const mainSdk = createFakeMainSdk({ featureId: "terminal" });
		await expect(createTerminalCwdResolver(mainSdk, alias)()).resolves.toBe(await realpath(home));
	});

	it("canonicalizes and accepts only Kilo primary folders", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "terminal-auth-"));
		const primary = path.join(root, "primary");
		const secondary = path.join(root, "secondary");
		const alias = path.join(root, "alias");
		await mkdir(primary);
		await mkdir(secondary);
		await symlink(primary, alias);
		directories.push(root);

		const shared = createFakeSdk({ featureId: "harness" });
		const terminalSdk = createFakeMainSdk({ featureId: "terminal", services: shared.services });
		const kiloSdk = createFakeMainSdk({ featureId: "kilo-ui", services: shared.services });
		kiloSdk.plugins.expose("workspaceService", {
			list: async () => [
				{
					folders: [
						{ path: primary, isPrimary: true },
						{ path: secondary, isPrimary: false },
					],
				},
			],
		});
		const authorize = createTerminalCwdResolver(terminalSdk);
		await expect(authorize(alias)).resolves.toBe(await realpath(primary));
		await expect(authorize(secondary)).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("fails closed when Kilo's registry is unavailable", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "terminal" });
		await expect(createTerminalCwdResolver(mainSdk)("/tmp")).rejects.toMatchObject({
			code: "BUSINESS",
		});
	});
});
