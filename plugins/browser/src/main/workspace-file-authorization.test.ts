import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";

import { createWorkspaceFileAuthorization } from "./workspace-file-authorization.js";

let root: string;
let workspace: string;

beforeEach(async () => {
	root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-browser-auth-")));
	workspace = path.join(root, "project");
	await mkdir(workspace);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("createWorkspaceFileAuthorization", () => {
	it("allows files inside registered workspace folders only", async () => {
		const harness = createFakeSdk({ featureId: "test-harness" });
		const sdk = createFakeMainSdk({ featureId: "browser", services: harness.services });
		const authorize = createWorkspaceFileAuthorization(sdk);
		expect(await authorize(path.join(workspace, "Chart.html"))).toBe(false);

		createFakeMainSdk({ featureId: "kilo-ui", services: harness.services }).plugins.expose(
			"workspaceService",
			{ list: async () => [{ folders: [{ path: workspace }] }] },
		);

		expect(await authorize(path.join(workspace, "Chart.html"))).toBe(true);
		expect(await authorize(path.join(workspace, ".kilo", "worktrees", "x", "a.html"))).toBe(true);
		expect(await authorize(path.join(root, "project-evil", "a.html"))).toBe(false);
		expect(await authorize(path.join(root, "secret.html"))).toBe(false);
	});
});
