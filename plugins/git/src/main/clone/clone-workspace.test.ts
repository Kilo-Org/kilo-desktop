import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KernelError } from "@kilo-desktop/kernel";
import type { CreateWorkspaceInput, Workspace } from "@kilo-desktop/plugin-work-sessions/contracts";

import type { CloneSource } from "../../contracts/models";
import { cloneWorkspace, type CloneWorkspaceTarget } from "./clone-workspace";

const GITHUB: CloneSource = { kind: "github", repository: "acme/app" };
const URL_SOURCE: CloneSource = { kind: "url", url: "https://gitlab.com/acme/app.git" };

function workspaceOf(input: CreateWorkspaceInput): Workspace {
	return {
		id: "w1",
		name: input.name ?? "",
		folders: input.folders.map((folder, position) => ({ id: `f${position}`, position, ...folder })),
		createdAt: 0,
		updatedAt: 0,
	};
}

/** kilo.work-sessions' new-folder rules over a real parent folder. */
function workspaces(overrides: Partial<CloneWorkspaceTarget> = {}) {
	return {
		newFolderPath: vi.fn(async ({ parentPath, name }: { parentPath: string; name: string }) => {
			if (name.includes("/") || name.startsWith(".")) {
				throw new KernelError("VALIDATION", "Enter a single folder name.");
			}
			const destination = path.join(parentPath, name);
			if (fs.existsSync(destination)) {
				throw new KernelError("VALIDATION", `A folder named "${name}" already exists.`);
			}
			return { path: destination };
		}),
		create: vi.fn(async (input: CreateWorkspaceInput) => workspaceOf(input)),
		rememberNewFolderLocation: vi.fn(async () => undefined),
		...overrides,
	} satisfies CloneWorkspaceTarget;
}

/** Stands in for a real clone: creates the destination with a file in it. */
const fakeClone = () =>
	vi.fn(async (_source: CloneSource, destination: string) => {
		fs.mkdirSync(destination);
		fs.writeFileSync(path.join(destination, "README.md"), "# app\n");
	});

describe("cloneWorkspace", () => {
	let parent: string;

	beforeEach(() => {
		parent = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "kilo-clone-")));
	});

	afterEach(() => {
		fs.rmSync(parent, { recursive: true, force: true });
	});

	it("clones into <parent>/<name>, creates a workspace of it and remembers the parent", async () => {
		const clone = fakeClone();
		const target = workspaces();

		const workspace = await cloneWorkspace(
			{ source: GITHUB, name: " App ", color: "#34D399", parentPath: parent },
			{ workspaces: target, clone },
		);

		const destination = path.join(parent, "App");
		expect(clone).toHaveBeenCalledWith(GITHUB, destination);
		expect(target.create).toHaveBeenCalledWith({
			name: "App",
			color: "#34D399",
			folders: [{ path: destination, isPrimary: true }],
			source: "github-clone",
		});
		expect(target.rememberNewFolderLocation).toHaveBeenCalledWith({ path: parent });
		expect(workspace.folders[0]?.path).toBe(destination);
	});

	it("records a URL clone as its own source", async () => {
		const target = workspaces();

		await cloneWorkspace(
			{ source: URL_SOURCE, name: "app", parentPath: parent },
			{ workspaces: target, clone: fakeClone() },
		);

		expect(target.create).toHaveBeenCalledWith(
			expect.objectContaining({ source: "git-url-clone" }),
		);
	});

	it("refuses to clone over an existing folder", async () => {
		fs.mkdirSync(path.join(parent, "app"));
		const clone = fakeClone();

		await expect(
			cloneWorkspace(
				{ source: GITHUB, name: "app", parentPath: parent },
				{ workspaces: workspaces(), clone },
			),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(clone).not.toHaveBeenCalled();
	});

	it("propagates clone failures without creating a workspace", async () => {
		const target = workspaces();
		const clone = vi.fn(async () => {
			throw new KernelError("NOT_FOUND", "Repository not found.");
		});

		await expect(
			cloneWorkspace(
				{ source: GITHUB, name: "missing", parentPath: parent },
				{ workspaces: target, clone },
			),
		).rejects.toThrow("Repository not found.");
		expect(target.create).not.toHaveBeenCalled();
		expect(target.rememberNewFolderLocation).not.toHaveBeenCalled();
	});

	it("removes the fresh clone when the workspace cannot be created", async () => {
		const target = workspaces({
			create: vi.fn(async () => {
				throw new Error("database is locked");
			}),
		});

		await expect(
			cloneWorkspace(
				{ source: GITHUB, name: "app", parentPath: parent },
				{ workspaces: target, clone: fakeClone() },
			),
		).rejects.toThrow("database is locked");
		expect(fs.existsSync(path.join(parent, "app"))).toBe(false);
		expect(target.rememberNewFolderLocation).not.toHaveBeenCalled();
	});

	it("still answers the workspace when its location can't be remembered", async () => {
		const target = workspaces({
			rememberNewFolderLocation: vi.fn(async () => {
				throw new Error("settings are read-only");
			}),
		});

		await expect(
			cloneWorkspace(
				{ source: GITHUB, name: "app", parentPath: parent },
				{ workspaces: target, clone: fakeClone() },
			),
		).resolves.toMatchObject({ name: "app" });
		expect(fs.existsSync(path.join(parent, "app", "README.md"))).toBe(true);
	});

	it("validates the folder name before cloning", async () => {
		const clone = fakeClone();

		await expect(
			cloneWorkspace(
				{ source: GITHUB, name: "../escape", parentPath: parent },
				{ workspaces: workspaces(), clone },
			),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(clone).not.toHaveBeenCalled();
	});

	it("is unavailable without workspaces", async () => {
		const clone = fakeClone();

		await expect(
			cloneWorkspace(
				{ source: GITHUB, name: "app", parentPath: parent },
				{ workspaces: null, clone },
			),
		).rejects.toMatchObject({ code: "BUSINESS" });
		expect(clone).not.toHaveBeenCalled();
	});
});
