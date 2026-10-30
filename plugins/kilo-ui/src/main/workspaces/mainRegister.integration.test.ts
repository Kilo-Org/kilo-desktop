import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";
import type { KvStoreFactory } from "@kilo-desktop/feature-sdk";

import type { KiloGlobalConnection, KiloSessionPreparation } from "../../contracts/chat/schemas.js";
import { ONBOARDING_VERSION } from "../../contracts/onboarding/schemas.js";
import type { WorkspaceCapabilities } from "../../contracts/workspaces/schemas.js";
import { mainRegister } from "../index.js";

const PLUGIN_DIR = path.resolve(import.meta.dirname, "../../..");
const SERVER_CONNECTION = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	globalDirectory: "/plugin-data/kilo-server/runtime",
} satisfies KiloGlobalConnection;

function createPersistentKvFactory(): KvStoreFactory {
	const stores = new Map<string, Record<string, unknown>>();
	return (options) => {
		const namespace = options.namespace ?? "default";
		const initial = stores.get(namespace) ?? { ...options.defaults };
		stores.set(namespace, initial);
		return {
			snapshot: () => ({ ...stores.get(namespace) }) as typeof options.defaults,
			get: (key) => stores.get(namespace)?.[String(key)] as (typeof options.defaults)[typeof key],
			set: (patch) => {
				const next = { ...stores.get(namespace), ...patch } as typeof options.defaults;
				stores.set(namespace, next);
				return { ...next };
			},
			clear: () => stores.set(namespace, { ...options.defaults }),
		};
	};
}

function createFailingCleanupKvFactory(): KvStoreFactory {
	const createKvStore = createPersistentKvFactory();
	return (options) => {
		const store = createKvStore(options);
		if (options.namespace !== "workspace-session-cleanup") return store;
		return {
			...store,
			set: () => {
				throw new Error("Storage is unavailable.");
			},
		};
	};
}

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
		// WorkspaceService stores canonical folder paths; macOS tmpdir is a /var -> /private/var symlink.
		const userData = fs.realpathSync.native(
			fs.mkdtempSync(path.join(os.tmpdir(), "kilo-ui-main-")),
		);
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
		const getConnection = vi.fn(async () => SERVER_CONNECTION);
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

	it("reports stored workspace folders that become unavailable", async () => {
		const { mainSdk, project } = boot();
		const created = (await mainSdk.invoke("create", {
			folders: [{ path: project, isPrimary: true }],
		})) as { id: string };
		fs.rmSync(project, { recursive: true });

		await expect(mainSdk.invoke("workspaceStatus.list")).resolves.toEqual([
			{ workspaceId: created.id, unavailableFolders: [project] },
		]);
	});

	it("clears the deleted workspace from matching chats", async () => {
		const unscopeWorkspaceSessions = vi.fn(async () => undefined);
		const userData = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-ui-main-"));
		const storageDir = path.join(userData, "plugins", "kilo-ui");
		const project = path.join(userData, "Project");
		fs.mkdirSync(storageDir, { recursive: true });
		fs.mkdirSync(project);
		directories.push(userData);

		const mainSdk = createFakeMainSdk({
			featureId: "kilo-ui",
			storageDir,
			pluginDir: PLUGIN_DIR,
		});
		disposables.push(() => mainSdk.dispose());
		mainRegister(mainSdk, { unscopeWorkspaceSessions });

		const created = (await mainSdk.invoke("create", {
			folders: [{ path: project, isPrimary: true }],
		})) as { id: string };
		await expect(mainSdk.invoke("remove", { id: created.id })).resolves.toEqual({ deleted: true });
		expect(unscopeWorkspaceSessions).toHaveBeenCalledWith(created.id);
	});

	it("keeps workspace deletion successful when pending cleanup cannot be persisted", async () => {
		const unscopeWorkspaceSessions = vi.fn(async () => undefined);
		const userData = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-ui-main-"));
		const storageDir = path.join(userData, "plugins", "kilo-ui");
		const project = path.join(userData, "Project");
		fs.mkdirSync(storageDir, { recursive: true });
		fs.mkdirSync(project);
		directories.push(userData);

		const mainSdk = createFakeMainSdk({
			featureId: "kilo-ui",
			storageDir,
			pluginDir: PLUGIN_DIR,
			createKvStore: createFailingCleanupKvFactory(),
		});
		disposables.push(() => mainSdk.dispose());
		mainRegister(mainSdk, { unscopeWorkspaceSessions });

		const created = (await mainSdk.invoke("create", {
			folders: [{ path: project, isPrimary: true }],
		})) as { id: string };
		await expect(mainSdk.invoke("remove", { id: created.id })).resolves.toEqual({
			deleted: true,
		});
		await vi.waitFor(() => expect(unscopeWorkspaceSessions).toHaveBeenCalledWith(created.id));
	});

	it("does not wait for chat cleanup before completing workspace deletion", async () => {
		let finishCleanup!: () => void;
		const unscopeWorkspaceSessions = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishCleanup = resolve;
				}),
		);
		const userData = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-ui-main-"));
		const storageDir = path.join(userData, "plugins", "kilo-ui");
		const project = path.join(userData, "Project");
		fs.mkdirSync(storageDir, { recursive: true });
		fs.mkdirSync(project);
		directories.push(userData);

		const mainSdk = createFakeMainSdk({
			featureId: "kilo-ui",
			storageDir,
			pluginDir: PLUGIN_DIR,
			createKvStore: createPersistentKvFactory(),
		});
		disposables.push(() => mainSdk.dispose());
		mainRegister(mainSdk, { unscopeWorkspaceSessions });

		const created = (await mainSdk.invoke("create", {
			folders: [{ path: project, isPrimary: true }],
		})) as { id: string };
		const removal = mainSdk.invoke("remove", { id: created.id });
		await vi.waitFor(() => expect(unscopeWorkspaceSessions).toHaveBeenCalledWith(created.id));

		let result: unknown;
		void removal.then((value) => {
			result = value;
		});
		try {
			await vi.waitFor(() => expect(result).toEqual({ deleted: true }), { timeout: 200 });
		} finally {
			finishCleanup();
		}
	});

	it("retries failed chat cleanup after the plugin restarts", async () => {
		const userData = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-ui-main-"));
		const storageDir = path.join(userData, "plugins", "kilo-ui");
		const project = path.join(userData, "Project");
		fs.mkdirSync(storageDir, { recursive: true });
		fs.mkdirSync(project);
		directories.push(userData);

		const failingCleanup = vi.fn(async () => {
			throw new Error("Kilo is unavailable.");
		});
		const createKvStore = createPersistentKvFactory();
		const firstSdk = createFakeMainSdk({
			featureId: "kilo-ui",
			storageDir,
			pluginDir: PLUGIN_DIR,
			createKvStore,
		});
		mainRegister(firstSdk, { unscopeWorkspaceSessions: failingCleanup });

		const created = (await firstSdk.invoke("create", {
			folders: [{ path: project, isPrimary: true }],
		})) as { id: string };
		await expect(firstSdk.invoke("remove", { id: created.id })).resolves.toEqual({
			deleted: true,
		});
		expect(failingCleanup).toHaveBeenCalledWith(created.id);
		firstSdk.dispose();

		const recoveredCleanup = vi.fn(async () => undefined);
		const secondSdk = createFakeMainSdk({
			featureId: "kilo-ui",
			storageDir,
			pluginDir: PLUGIN_DIR,
			createKvStore,
		});
		disposables.push(() => secondSdk.dispose());
		mainRegister(secondSdk, { unscopeWorkspaceSessions: recoveredCleanup });

		await vi.waitFor(() => expect(recoveredCleanup).toHaveBeenCalledWith(created.id));
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
		const { mainSdk, storageDir, getConnection, exposeConnectionService } = boot();
		const chatsDirectory = path.resolve(storageDir, "../..", "chats");

		await expect(mainSdk.invoke("chat.getConnection")).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Kilo Server is unavailable.",
		});

		exposeConnectionService();
		await expect(mainSdk.invoke("chat.getConnection")).resolves.toEqual(SERVER_CONNECTION);
		expect(getConnection).toHaveBeenCalledWith();
		expect(fs.existsSync(chatsDirectory)).toBe(false);
	});

	it("prepares a session in a workspace primary folder", async () => {
		const { mainSdk, project, userData, exposeConnectionService } = boot();
		exposeConnectionService();
		const reference = path.join(userData, "Reference");
		fs.mkdirSync(reference);

		const created = (await mainSdk.invoke("create", {
			folders: [
				{ path: project, isPrimary: true },
				{ path: reference, isPrimary: false },
			],
		})) as { id: string; folders: Array<{ path: string; isPrimary: boolean }> };
		const primary = created.folders.find((folder) => folder.isPrimary);
		expect(primary).toBeDefined();

		await expect(
			mainSdk.invoke("chat.prepareSession", { workspaceId: created.id }),
		).resolves.toEqual({
			directory: primary!.path,
			workspaceId: created.id,
			workspaceFolders: created.folders.map(({ path, isPrimary }) => ({ path, isPrimary })),
		});
	});

	it("creates unique unscoped session directories only when prepared", async () => {
		const { mainSdk, storageDir } = boot();
		const chatsDirectory = path.resolve(storageDir, "../..", "chats");
		expect(fs.existsSync(chatsDirectory)).toBe(false);
		const first = (await mainSdk.invoke("chat.prepareSession", {})) as KiloSessionPreparation;
		const second = (await mainSdk.invoke("chat.prepareSession", {})) as KiloSessionPreparation;
		expect(first.directory).not.toBe(second.directory);
		expect(path.dirname(first.directory)).toBe(chatsDirectory);
		expect(fs.statSync(first.directory).isDirectory()).toBe(true);
		expect(fs.statSync(second.directory).isDirectory()).toBe(true);
		expect(first.workspaceFolders).toEqual([]);
		expect(second.workspaceFolders).toEqual([]);
	});

	it("persists onboarding complete and skip", async () => {
		const { mainSdk } = boot();
		await expect(mainSdk.invoke("onboarding.get")).resolves.toEqual({
			outcome: null,
			closedAt: null,
			version: null,
		});
		const completed = await mainSdk.invoke("onboarding.complete");
		expect(completed).toMatchObject({ outcome: "completed", version: ONBOARDING_VERSION });
		expect(typeof (completed as { closedAt: number }).closedAt).toBe("number");
		await expect(mainSdk.invoke("onboarding.get")).resolves.toEqual(completed);
		const skipped = await mainSdk.invoke("onboarding.skip");
		expect(skipped).toMatchObject({ outcome: "skipped" });
		mainSdk.dispose();
	});

	it("persists terms acceptance and the accounts it is linked to", async () => {
		const { mainSdk } = boot();
		await expect(mainSdk.invoke("onboarding.terms.get")).resolves.toBeNull();
		const accepted = await mainSdk.invoke("onboarding.terms.accept", { version: "v1" });
		expect(accepted).toMatchObject({ version: "v1", linkedAccounts: [] });
		await expect(
			mainSdk.invoke("onboarding.terms.markLinked", { accountKey: "acct" }),
		).resolves.toMatchObject({ linkedAccounts: ["acct"] });
		await expect(mainSdk.invoke("onboarding.terms.get")).resolves.toMatchObject({
			version: "v1",
			linkedAccounts: ["acct"],
		});
		mainSdk.dispose();
	});

	it("rejects session preparation for a missing workspace", async () => {
		const { mainSdk, exposeConnectionService } = boot();
		exposeConnectionService();

		await expect(
			mainSdk.invoke("chat.prepareSession", {
				workspaceId: "missing-workspace",
			}),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Workspace not found.",
		});
	});
});
