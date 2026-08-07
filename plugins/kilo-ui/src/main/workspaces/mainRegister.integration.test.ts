import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import type { KiloWorkspaceConnection } from "../../contracts/chat/schemas.js";
import type { WorkspaceCapabilities } from "../../contracts/workspaces/schemas.js";
import { mainRegister } from "../index.js";

const PLUGIN_DIR = path.resolve(import.meta.dirname, "../../..");
const CHAT_ID = "11111111-1111-4111-8111-111111111111";
const SERVER_CONNECTION = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
} satisfies Omit<KiloWorkspaceConnection, "directory">;

describe("kilo-ui mainRegister", () => {
	const directories: string[] = [];
	const disposables: Array<() => void> = [];

	afterEach(() => {
		for (const dispose of disposables.splice(0).reverse()) {
			dispose();
		}
		for (const directory of directories.splice(0)) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	function boot() {
		const userData = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-ui-main-"));
		const storageDir = path.join(userData, "plugins", "kilo-ui");
		const project = path.join(userData, "Project");
		fs.mkdirSync(storageDir, { recursive: true });
		fs.mkdirSync(project);
		directories.push(userData);

		const harnessSdk = createFakeSdk({ featureId: "test-harness" });
		const mainSdk = createFakeMainSdk({
			featureId: "kilo-ui",
			storageDir,
			pluginDir: PLUGIN_DIR,
			services: harnessSdk.services,
		});
		const kiloServerSdk = createFakeMainSdk({
			featureId: "kilo-server",
			services: harnessSdk.services,
		});
		const getConnection = vi.fn(async ({ directory }: { directory: string }) => ({
			...SERVER_CONNECTION,
			directory,
		}));
		const exposeConnectionService = () => {
			kiloServerSdk.plugins.expose("connectionService", { getConnection });
		};

		mainRegister(mainSdk);
		disposables.push(
			() => harnessSdk.destroy(),
			() => kiloServerSdk.dispose(),
			() => mainSdk.dispose(),
		);
		return {
			mainSdk,
			project,
			storageDir,
			userData,
			getConnection,
			exposeConnectionService,
		};
	}

	it("registers CRUD, persists data, and emits exact post-commit snapshots", async () => {
		const { mainSdk, project, storageDir } = boot();
		const createdEvent = vi.fn();
		const updatedEvent = vi.fn();
		const deletedEvent = vi.fn();
		mainSdk.events.on("kilo-ui.workspace-created", createdEvent);
		mainSdk.events.on("kilo-ui.workspace-updated", updatedEvent);
		mainSdk.events.on("kilo-ui.workspace-deleted", deletedEvent);

		const created = (await mainSdk.invoke("create", {
			folders: [{ path: project, isPrimary: true }],
		})) as { id: string; name: string };
		expect(created.name).toBe("Project");
		expect(createdEvent).toHaveBeenCalledWith({ before: null, after: created });
		const capability = mainSdk.plugins.get<WorkspaceCapabilities>("kilo-ui")?.workspaceService;
		expect(capability).toBeDefined();
		await expect(capability!.get(created.id)).resolves.toEqual(created);

		const updated = await mainSdk.invoke("update", {
			id: created.id,
			name: "Renamed",
			folders: [{ path: project, isPrimary: true }],
		});
		expect(updatedEvent).toHaveBeenCalledWith({ before: created, after: updated });
		await expect(mainSdk.invoke("list")).resolves.toEqual([updated]);
		expect(fs.existsSync(path.join(storageDir, "data.db"))).toBe(true);

		await expect(capability!.remove(created.id)).resolves.toEqual({ deleted: true });
		expect(deletedEvent).toHaveBeenCalledWith({ before: updated, after: null });
		mainSdk.dispose();
	});

	it("validates channels and closes the database on disposal", async () => {
		const { mainSdk, project } = boot();
		await expect(mainSdk.invoke("create", { folders: [] })).rejects.toMatchObject({
			code: "VALIDATION",
		});
		await expect(mainSdk.invoke("get", { id: "missing" })).resolves.toBeNull();
		await expect(
			mainSdk.invoke("update", {
				id: "missing",
				name: "Missing",
				folders: [{ path: project, isPrimary: true }],
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		mainSdk.dispose();
		await expect(mainSdk.invoke("list")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("resolves the kilo-server capability lazily for chat connections", async () => {
		const { mainSdk, userData, getConnection, exposeConnectionService } = boot();

		await expect(mainSdk.invoke("chat.getConnection", { chatId: CHAT_ID })).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Kilo Server is unavailable.",
		});

		exposeConnectionService();
		const expectedDirectory = path.join(userData, "chats", CHAT_ID);
		await expect(mainSdk.invoke("chat.getConnection", { chatId: CHAT_ID })).resolves.toEqual({
			...SERVER_CONNECTION,
			directory: expectedDirectory,
		});
		expect(getConnection).toHaveBeenCalledWith({ directory: expectedDirectory });
		expect(fs.statSync(expectedDirectory).isDirectory()).toBe(true);
	});

	it("scopes chat connections to a workspace primary folder", async () => {
		const { mainSdk, project, getConnection, exposeConnectionService } = boot();
		exposeConnectionService();

		const created = (await mainSdk.invoke("create", {
			folders: [{ path: project, isPrimary: true }],
		})) as { id: string; folders: Array<{ path: string; isPrimary: boolean }> };
		const primary = created.folders.find((folder) => folder.isPrimary);
		expect(primary).toBeDefined();

		await expect(
			mainSdk.invoke("chat.getConnection", { chatId: CHAT_ID, workspaceId: created.id }),
		).resolves.toEqual({
			...SERVER_CONNECTION,
			directory: primary!.path,
		});
		expect(getConnection).toHaveBeenCalledWith({ directory: primary!.path });
	});

	it("rejects chat connections for a missing workspace", async () => {
		const { mainSdk, exposeConnectionService } = boot();
		exposeConnectionService();

		await expect(
			mainSdk.invoke("chat.getConnection", {
				chatId: CHAT_ID,
				workspaceId: "missing-workspace",
			}),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Workspace not found.",
		});
	});
});
