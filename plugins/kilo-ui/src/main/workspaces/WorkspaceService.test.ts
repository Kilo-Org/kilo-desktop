import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWorkspacesDatabase, type WorkspacesDatabase } from "./db.js";
import { WorkspaceService } from "./WorkspaceService.js";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../../drizzle");

describe("WorkspaceService", () => {
	let root: string;
	let db: WorkspacesDatabase;
	let service: WorkspaceService;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "workspaces-service-"));
		db = createWorkspacesDatabase(path.join(root, "data.db"), MIGRATIONS);
		service = new WorkspaceService(db);
	});

	afterEach(() => {
		db.$client.close();
		fs.rmSync(root, { recursive: true, force: true });
	});

	const folder = (name: string) => {
		const folderPath = path.join(root, name);
		fs.mkdirSync(folderPath);
		return folderPath;
	};

	it("trims supplied names and derives unique names from the primary folder", () => {
		const primary = folder("Project");
		expect(
			service.create({ name: "  Explicit  ", folders: [{ path: primary, isPrimary: true }] }).name,
		).toBe("Explicit");

		service.create({ name: "project", folders: [{ path: folder("Other"), isPrimary: true }] });
		expect(service.create({ name: " ", folders: [{ path: primary, isPrimary: true }] }).name).toBe(
			"Project (2)",
		);
	});

	it("fills the first available generated suffix", () => {
		const project = folder("Project");
		service.create({ folders: [{ path: project, isPrimary: true }] });
		service.create({ name: "Project (3)", folders: [{ path: folder("Three"), isPrimary: true }] });
		expect(service.create({ folders: [{ path: project, isPrimary: true }] }).name).toBe(
			"Project (2)",
		);
		expect(service.create({ folders: [{ path: project, isPrimary: true }] }).name).toBe(
			"Project (4)",
		);
	});

	it("keeps retained folder ids, normalizes primary ordering, and only renames when cleared", () => {
		const first = folder("First");
		const second = folder("Second");
		const third = folder("Third");
		const created = service.create({
			name: "My workspace",
			folders: [
				{ path: first, isPrimary: true },
				{ path: second, isPrimary: false },
			],
		});
		const [createdFirst, createdSecond] = created.folders;

		const updated = service.update(created.id, {
			folders: [
				{ path: first, isPrimary: false },
				{ path: second, isPrimary: true },
				{ path: third, isPrimary: false },
			],
		});
		expect(updated.name).toBe("My workspace");
		expect(updated.folders.map((item) => item.path)).toEqual([
			createdSecond!.path,
			createdFirst!.path,
			fs.realpathSync.native(third),
		]);
		expect(updated.folders.slice(0, 2).map((item) => item.id)).toEqual([
			createdSecond!.id,
			createdFirst!.id,
		]);
		expect(updated.folders[2]!.id).not.toBe(createdFirst!.id);
		expect(updated.folders[2]!.id).not.toBe(createdSecond!.id);

		expect(service.update(created.id, { name: "", folders: updated.folders }).name).toBe("Second");
	});

	it("excludes the edited workspace when generating a name", () => {
		const project = folder("Project");
		const created = service.create({ folders: [{ path: project, isPrimary: true }] });
		expect(service.update(created.id, { name: "", folders: created.folders }).name).toBe("Project");
	});

	it("enforces folder safety and primary invariants", () => {
		const project = folder("Project");
		const file = path.join(root, "file.txt");
		fs.writeFileSync(file, "not a directory");
		expect(() => service.create({ folders: [] })).toThrow("at least one folder");
		expect(() => service.create({ folders: [{ path: project, isPrimary: false }] })).toThrow(
			"exactly one primary",
		);
		expect(() =>
			service.create({
				folders: [
					{ path: project, isPrimary: true },
					{ path: project, isPrimary: false },
				],
			}),
		).toThrow("unique");
		expect(() =>
			service.create({ folders: [{ path: path.parse(root).root, isPrimary: true }] }),
		).toThrow("Filesystem roots");
		expect(() => service.create({ folders: [{ path: os.homedir(), isPrimary: true }] })).toThrow(
			"home directory",
		);
		expect(() => service.create({ folders: [{ path: "relative", isPrimary: true }] })).toThrow(
			"absolute paths",
		);
		expect(() => service.create({ folders: [{ path: file, isPrimary: true }] })).toThrow(
			"does not exist or is not a directory",
		);
	});

	it("returns null for missing reads, rejects missing mutations, and rolls back failures", () => {
		expect(service.get("missing")).toBeNull();
		expect(() =>
			service.update("missing", {
				folders: [{ path: folder("Missing"), isPrimary: true }],
			}),
		).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
		db.$client.close();
		db = createWorkspacesDatabase(path.join(root, "rollback.db"), MIGRATIONS);
		service = new WorkspaceService(db, () => "same-id");
		expect(() =>
			service.create({
				folders: [
					{ path: folder("One"), isPrimary: true },
					{ path: folder("Two"), isPrimary: false },
				],
			}),
		).toThrow();
		expect(service.list()).toEqual([]);
	});

	it("defaults new workspaces to the first identity color and persists updates", () => {
		const project = folder("Project");
		const created = service.create({ folders: [{ path: project, isPrimary: true }] });
		expect(created.color).toBe("#5EA0F7");
		expect(service.get(created.id)?.color).toBe("#5EA0F7");

		const custom = service.create({
			name: "Custom",
			color: "#34d",
			folders: [{ path: folder("Other"), isPrimary: true }],
		});
		expect(custom.color).toBe("#3344DD");

		expect(
			service.update(custom.id, {
				name: "Custom",
				folders: custom.folders,
			}).color,
		).toBe("#3344DD");
		expect(
			service.update(custom.id, {
				name: "Custom",
				color: "#f87171",
				folders: custom.folders,
			}).color,
		).toBe("#F87171");
		expect(() =>
			service.create({
				color: "blue",
				folders: [{ path: folder("Bad"), isPrimary: true }],
			}),
		).toThrow("Invalid identity color");
	});

	it("cascades folders when a workspace is removed", () => {
		const created = service.create({ folders: [{ path: folder("Project"), isPrimary: true }] });
		expect(service.remove(created.id)).toEqual(created);
		expect(service.list()).toEqual([]);
		expect(db.$client.prepare("select count(*) as count from workspace_folders").get()).toEqual({
			count: 0,
		});
	});
});
