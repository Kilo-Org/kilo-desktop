import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

import { mainRegister } from "./index.js";

describe("workspaces mainRegister", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0)) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	function boot() {
		const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "workspaces-main-"));
		const project = path.join(storageDir, "Project");
		fs.mkdirSync(project);
		directories.push(storageDir);
		const mainSdk = createFakeMainSdk({ featureId: "workspaces", storageDir });
		mainRegister(mainSdk);
		return { mainSdk, project, storageDir };
	}

	it("registers CRUD, persists data, and emits exact post-commit snapshots", async () => {
		const { mainSdk, project, storageDir } = boot();
		const createdEvent = vi.fn();
		const updatedEvent = vi.fn();
		const deletedEvent = vi.fn();
		mainSdk.events.on("workspaces.workspace-created", createdEvent);
		mainSdk.events.on("workspaces.workspace-updated", updatedEvent);
		mainSdk.events.on("workspaces.workspace-deleted", deletedEvent);

		const created = (await mainSdk.invoke("create", {
			folders: [{ path: project, isPrimary: true }],
		})) as { id: string; name: string };
		expect(created.name).toBe("Project");
		expect(createdEvent).toHaveBeenCalledWith({ before: null, after: created });

		const updated = await mainSdk.invoke("update", {
			id: created.id,
			name: "Renamed",
			folders: [{ path: project, isPrimary: true }],
		});
		expect(updatedEvent).toHaveBeenCalledWith({ before: created, after: updated });
		await expect(mainSdk.invoke("list")).resolves.toEqual([updated]);
		expect(fs.existsSync(path.join(storageDir, "data.db"))).toBe(true);

		await expect(mainSdk.invoke("remove", { id: created.id })).resolves.toEqual({ deleted: true });
		expect(deletedEvent).toHaveBeenCalledWith({ before: updated, after: null });
		mainSdk.dispose();
	});

	it("validates channels and closes the database on disposal", async () => {
		const { mainSdk } = boot();
		await expect(mainSdk.invoke("create", { folders: [] })).rejects.toMatchObject({
			code: "VALIDATION",
		});
		await expect(mainSdk.invoke("get", { id: "missing" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		mainSdk.dispose();
		await expect(mainSdk.invoke("list")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
