import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import type { PluginRegistration, PluginSdk } from "@kilo-desktop/kernel";
import { createMemoryStorage, createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import {
	DEFAULT_WORKSPACE_IDENTITY_COLOR,
	HAS_WORKSPACES_KEY,
	Vcs,
	VCS_KEY,
	Workspaces,
	WORKSPACES_DEFINITIONS,
	type WorkspaceChange,
} from "../contracts";
import { createWorkspacesMainEntry } from "./entry";

let root: string;

beforeEach(async () => {
	root = await realpath(await mkdtemp(path.join(tmpdir(), "kilo-workspaces-")));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function folder(name: string): Promise<string> {
	const dir = path.join(root, name);
	await mkdir(dir, { recursive: true });
	return dir;
}

async function boot(
	options: {
		storage?: ReturnType<typeof createMemoryStorage>;
		originDatabase?: string;
		plugins?: PluginRegistration[];
	} = {},
) {
	const storage = options.storage ?? createMemoryStorage("/data/kilo.workspaces");
	let id = 0;
	const kernel: MainKernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			{
				manifest,
				definitions: WORKSPACES_DEFINITIONS,
				entry: createWorkspacesMainEntry({
					createId: () => `id-${++id}`,
					now: () => 1_000,
					...(options.originDatabase ? { originDatabase: options.originDatabase } : {}),
					watch: false,
				}),
			},
			...(options.plugins ?? []),
		],
		hostServices: () => ({ storage }),
	});
	await kernel.start();
	const workspaces = kernel.kernelSdk.domains.get(Workspaces)!;
	const events: { name: string; change: WorkspaceChange }[] = [];
	for (const name of ["created", "updated", "deleted"] as const) {
		workspaces.on(name, (change) => events.push({ name, change }));
	}
	return { kernel, workspaces, events, storage };
}

describe("creating workspaces", () => {
	it("names a workspace after its primary folder and resolves its folders", async () => {
		const app = await folder("app");
		const { workspaces, events } = await boot();

		const created = await workspaces.methods.create({ folders: [{ path: app, isPrimary: true }] });

		expect(created).toMatchObject({
			name: "app",
			color: DEFAULT_WORKSPACE_IDENTITY_COLOR,
			folders: [{ path: app, isPrimary: true, position: 0 }],
		});
		expect(workspaces.getState().workspaces).toEqual([created]);
		expect(events).toEqual([{ name: "created", change: { before: null, after: created } }]);
	});

	it("keeps names unique and puts the primary folder first", async () => {
		const a = await folder("one/app");
		const b = await folder("two/app");
		const docs = await folder("docs");
		const { workspaces } = await boot();
		await workspaces.methods.create({ folders: [{ path: a, isPrimary: true }] });

		const second = await workspaces.methods.create({
			color: "#abc",
			folders: [
				{ path: docs, isPrimary: false },
				{ path: b, isPrimary: true },
			],
		});

		expect(second.name).toBe("app (2)");
		expect(second.color).toBe("#AABBCC");
		expect(second.folders.map((f) => [f.path, f.isPrimary, f.position])).toEqual([
			[b, true, 0],
			[docs, false, 1],
		]);
	});

	it("refuses folders that aren't safe to use", async () => {
		const app = await folder("app");
		const file = path.join(root, "notes.txt");
		await writeFile(file, "x");
		const { workspaces } = await boot();
		const attempt = (folders: { path: string; isPrimary: boolean }[]) =>
			workspaces.methods.create({ folders });

		await expect(attempt([{ path: "relative/app", isPrimary: true }])).rejects.toThrow(/absolute/);
		await expect(attempt([{ path: path.join(root, "missing"), isPrimary: true }])).rejects.toThrow(
			/does not exist/,
		);
		await expect(attempt([{ path: file, isPrimary: true }])).rejects.toThrow(/not a directory/);
		await expect(attempt([{ path: path.parse(root).root, isPrimary: true }])).rejects.toThrow(
			/roots and the home/,
		);
		await expect(attempt([{ path: homedir(), isPrimary: true }])).rejects.toThrow(
			/roots and the home/,
		);
		await expect(
			attempt([
				{ path: app, isPrimary: true },
				{ path: `${app}/`, isPrimary: false },
			]),
		).rejects.toThrow(/unique/);
		await expect(
			attempt([
				{ path: app, isPrimary: true },
				{ path: root, isPrimary: true },
			]),
		).rejects.toThrow(/exactly one primary/);
		expect(workspaces.getState().workspaces).toEqual([]);
	});
});

describe("changing and removing workspaces", () => {
	it("keeps folder ids for folders that stay, and the name unless given", async () => {
		const app = await folder("app");
		const docs = await folder("docs");
		const { workspaces, events } = await boot();
		const created = await workspaces.methods.create({ folders: [{ path: app, isPrimary: true }] });

		const updated = await workspaces.methods.update({
			id: created.id,
			folders: [
				{ path: app, isPrimary: true },
				{ path: docs, isPrimary: false },
			],
		});

		expect(updated.name).toBe("app");
		expect(updated.folders[0]!.id).toBe(created.folders[0]!.id);
		expect(events.at(-1)).toEqual({ name: "updated", change: { before: created, after: updated } });
		await expect(
			workspaces.methods.update({
				id: created.id,
				color: "orange",
				folders: [{ path: app, isPrimary: true }],
			}),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("removes a workspace and clears it if it was active", async () => {
		const app = await folder("app");
		const { kernel, workspaces, events } = await boot();
		const created = await workspaces.methods.create({ folders: [{ path: app, isPrimary: true }] });
		await workspaces.methods.setActive({ id: created.id });
		expect(kernel.kernelSdk.context.get(HAS_WORKSPACES_KEY)).toBe(true);

		await expect(workspaces.methods.remove({ id: created.id })).resolves.toEqual({ deleted: true });

		expect(workspaces.getState()).toMatchObject({ workspaces: [], activeId: null });
		expect(events.at(-1)).toEqual({ name: "deleted", change: { before: created, after: null } });
		expect(kernel.kernelSdk.context.get(HAS_WORKSPACES_KEY)).toBe(false);
		await expect(workspaces.methods.remove({ id: created.id })).resolves.toEqual({
			deleted: false,
		});
	});

	it("moves the active workspace to the next one when it is removed", async () => {
		const zeta = await folder("zeta");
		const alpha = await folder("alpha");
		const beta = await folder("beta");
		const { workspaces } = await boot();
		const removed = await workspaces.methods.create({ folders: [{ path: zeta, isPrimary: true }] });
		await workspaces.methods.create({ folders: [{ path: beta, isPrimary: true }] });
		const first = await workspaces.methods.create({ folders: [{ path: alpha, isPrimary: true }] });
		await workspaces.methods.setActive({ id: removed.id });

		await workspaces.methods.remove({ id: removed.id });

		expect(workspaces.getState().activeId).toBe(first.id);
	});

	it("only activates workspaces that exist, and remembers them across launches", async () => {
		const app = await folder("app");
		const storage = createMemoryStorage("/data/kilo.workspaces");
		const { workspaces } = await boot({ storage });
		const created = await workspaces.methods.create({ folders: [{ path: app, isPrimary: true }] });

		await expect(workspaces.methods.setActive({ id: "nope" })).rejects.toMatchObject({
			code: "VALIDATION",
		});
		await workspaces.methods.setActive({ id: created.id });

		const relaunched = await boot({ storage });
		expect(relaunched.workspaces.getState()).toMatchObject({
			workspaces: [created],
			activeId: created.id,
		});
	});
});

describe("folder availability", () => {
	it("reports folders that can no longer be read", async () => {
		const app = await folder("app");
		const docs = await folder("docs");
		const { workspaces } = await boot();
		const created = await workspaces.methods.create({
			folders: [
				{ path: app, isPrimary: true },
				{ path: docs, isPrimary: false },
			],
		});

		await rm(docs, { recursive: true });
		await workspaces.methods.checkFolders(undefined);

		expect(workspaces.getState().unavailableFolderIds).toEqual([created.folders[1]!.id]);
	});

	// macOS privacy prompts (Desktop, Documents) deny reads on folders that
	// still exist; those aren't "moved or deleted", so they must not warn.
	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"does not report a folder that exists but denies reads",
		async () => {
			const app = await folder("app");
			const locked = await folder("locked");
			const { workspaces } = await boot();
			await workspaces.methods.create({
				folders: [
					{ path: app, isPrimary: true },
					{ path: locked, isPrimary: false },
				],
			});

			await chmod(locked, 0o000);
			try {
				await workspaces.methods.checkFolders(undefined);
				expect(workspaces.getState().unavailableFolderIds).toEqual([]);
			} finally {
				await chmod(locked, 0o755);
			}
		},
	);
});

describe("authorizing paths", () => {
	async function setUp() {
		const app = await folder("app");
		const docs = await folder("docs");
		const worktree = await folder("app/.kilo/worktrees/feature");
		const nested = await folder("app/src");
		const outside = await folder("elsewhere");
		const link = path.join(root, "link-to-src");
		await symlink(nested, link);
		const booted = await boot();
		const created = await booted.workspaces.methods.create({
			folders: [
				{ path: app, isPrimary: true },
				{ path: docs, isPrimary: false },
			],
		});
		const allowed = async (target: string, rule: "folder" | "primary" | "inside") =>
			(await booted.workspaces.methods.authorize({ path: target, rule })).allowed;
		return { ...booted, created, app, docs, worktree, nested, outside, link, allowed };
	}

	it("allows a workspace folder or a managed worktree of one under `folder`", async () => {
		const { app, docs, worktree, nested, allowed, workspaces, created } = await setUp();

		expect(await allowed(app, "folder")).toBe(true);
		expect(await allowed(docs, "folder")).toBe(true);
		expect(await allowed(worktree, "folder")).toBe(true);
		expect(await allowed(nested, "folder")).toBe(false);
		await expect(workspaces.methods.authorize({ path: worktree, rule: "folder" })).resolves.toEqual(
			{
				allowed: true,
				workspaceId: created.id,
				folder: app,
				path: worktree,
			},
		);
	});

	it("allows only primary folders (and their worktrees) under `primary`", async () => {
		const { app, docs, worktree, allowed } = await setUp();

		expect(await allowed(app, "primary")).toBe(true);
		expect(await allowed(worktree, "primary")).toBe(true);
		expect(await allowed(docs, "primary")).toBe(false);
	});

	it("allows anything inside a workspace folder under `inside`, following symlinks", async () => {
		const { nested, link, outside, allowed } = await setUp();

		expect(await allowed(nested, "inside")).toBe(true);
		expect(await allowed(path.join(nested, "new-file.html"), "inside")).toBe(true);
		expect(await allowed(link, "inside")).toBe(true);
		expect(await allowed(outside, "inside")).toBe(false);
		expect(await allowed(`${nested}/../../elsewhere`, "inside")).toBe(false);
	});
});

describe("importing origin's workspaces", () => {
	async function originDatabase(
		rows: { id: string; name: string; folders: string[]; color?: string | null }[],
	) {
		const file = path.join(root, "data.db");
		const db = new Database(file);
		db.exec(`
			CREATE TABLE workspaces (id text PRIMARY KEY, name text NOT NULL, color text,
				created_at integer NOT NULL, updated_at integer NOT NULL);
			CREATE TABLE workspace_folders (id text PRIMARY KEY, workspace_id text NOT NULL,
				path text NOT NULL, is_primary integer NOT NULL, position integer NOT NULL);
		`);
		for (const row of rows) {
			db.prepare("INSERT INTO workspaces VALUES (?, ?, ?, 10, 20)").run(
				row.id,
				row.name,
				row.color === undefined ? "#34d399" : row.color,
			);
			row.folders.forEach((folderPath, position) =>
				db
					.prepare("INSERT INTO workspace_folders VALUES (?, ?, ?, ?, ?)")
					.run(`${row.id}-f${position}`, row.id, folderPath, position === 0 ? 1 : 0, position),
			);
		}
		db.close();
		return file;
	}

	it("brings origin's workspaces over once", async () => {
		const app = await folder("app");
		const docs = await folder("docs");
		const database = await originDatabase([{ id: "w1", name: "App", folders: [app, docs] }]);
		const storage = createMemoryStorage("/data/kilo.workspaces");
		const { workspaces } = await boot({ storage, originDatabase: database });

		await vi.waitFor(() =>
			expect(workspaces.getState().workspaces).toEqual([
				{
					id: "w1",
					name: "App",
					color: "#34D399",
					createdAt: 10,
					updatedAt: 20,
					folders: [
						{ id: "w1-f0", path: app, isPrimary: true, position: 0 },
						{ id: "w1-f1", path: docs, isPrimary: false, position: 1 },
					],
				},
			]),
		);

		await workspaces.methods.remove({ id: "w1" });
		const relaunched = await boot({ storage, originDatabase: database });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(relaunched.workspaces.getState().workspaces).toEqual([]);
	});

	it("imports a workspace that had no colour", async () => {
		const app = await folder("app");
		const database = await originDatabase([{ id: "w1", name: "App", folders: [app], color: null }]);

		const { workspaces } = await boot({ originDatabase: database });

		await vi.waitFor(() => expect(workspaces.getState().workspaces).toHaveLength(1));
		expect(workspaces.getState().workspaces[0]).not.toHaveProperty("color");
	});

	it("never overwrites a workspace that already exists", async () => {
		const app = await folder("app");
		const storage = createMemoryStorage("/data/kilo.workspaces");
		const first = await boot({ storage });
		const created = await first.workspaces.methods.create({
			folders: [{ path: app, isPrimary: true }],
		});
		const database = await originDatabase([{ id: created.id, name: "Old", folders: [app] }]);

		const { workspaces } = await boot({ storage, originDatabase: database });
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(workspaces.getState().workspaces).toEqual([created]);
	});

	it("starts empty when origin's database is missing or unreadable", async () => {
		const garbage = path.join(root, "garbage.db");
		await writeFile(garbage, "not a database");

		const missing = await boot({ originDatabase: path.join(root, "absent.db") });
		const unreadable = await boot({ originDatabase: garbage });
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(missing.workspaces.getState().workspaces).toEqual([]);
		expect(unreadable.workspaces.getState().workspaces).toEqual([]);
	});
});

describe("the vcs key", () => {
	it("is true only while a vcs provider is implemented", async () => {
		let providerSdk: PluginSdk | undefined;
		const provider = testPlugin("test.vcs", {
			manifest: {
				requires: { "kilo.workspaces/vcs": "optional" },
				contributes: { extensions: { "kilo.workspaces/vcs": [{ id: "fake" }] } },
			},
			entry: {
				activate: (sdk) => {
					providerSdk = sdk;
				},
			},
		});
		const { kernel } = await boot({ plugins: [provider] });
		expect(kernel.kernelSdk.context.get(VCS_KEY)).toBe(false);

		const unbind = providerSdk!.extensions.implement(Vcs, "fake", {} as never);
		expect(kernel.kernelSdk.context.get(VCS_KEY)).toBe(true);

		unbind();
		expect(kernel.kernelSdk.context.get(VCS_KEY)).toBe(false);
	});
});
