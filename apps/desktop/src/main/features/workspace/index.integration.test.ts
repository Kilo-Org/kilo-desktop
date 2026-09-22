import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";
import type { WorkspaceWatcherCapability } from "@kilo-desktop/contracts";

import { mainRegister } from "./index.js";
import { createFakeParcelWatcher, type FakeParcelWatcher } from "./test/test-helpers.js";

const PROJECT_A = "/work/alpha";
const PROJECT_B = "/work/beta";

interface BootedHarness {
	harnessSdk: ReturnType<typeof createFakeSdk>;
	kiloSdk: ReturnType<typeof createFakeMainSdk>;
	workspaceSdk: ReturnType<typeof createFakeMainSdk>;
	parcel: FakeParcelWatcher;
	setWorkspaces: (workspaces: { folders: { path: string }[] }[]) => void;
}

type WorkspaceList = () => Promise<{ folders: { path: string }[] }[]>;

function boot(
	workspaces: { folders: { path: string }[] }[] = [{ folders: [{ path: PROJECT_A }] }],
	list?: WorkspaceList,
): BootedHarness {
	const harnessSdk = createFakeSdk({ featureId: "test-harness" });
	const parcel = createFakeParcelWatcher();
	const kiloSdk = createFakeMainSdk({ featureId: "kilo-ui", services: harnessSdk.services });
	const workspaceSdk = createFakeMainSdk({ featureId: "workspace", services: harnessSdk.services });

	let current = workspaces;
	kiloSdk.plugins.expose("workspaceService", {
		list: list ?? (async () => current),
	});

	return {
		harnessSdk,
		kiloSdk,
		workspaceSdk,
		parcel,
		setWorkspaces: (next) => {
			current = next;
		},
	};
}

const tick = (ms = 10) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

describe("workspace mainRegister", () => {
	let harness: BootedHarness | undefined;

	afterEach(async () => {
		if (!harness) return;
		await harness.workspaceSdk.disposeAsync();
		harness.kiloSdk.dispose();
		harness.harnessSdk.destroy();
		harness = undefined;
	});

	it("watches registered workspace folders at boot and emits batches on the event bus", async () => {
		harness = boot();
		await mainRegister(harness.workspaceSdk, {
			subscribeFn: harness.parcel.subscribe,
			realpath: (p) => p,
		});

		expect(harness.parcel.subscribeAttempts).toEqual([PROJECT_A]);

		const onFileChange = vi.fn();
		harness.workspaceSdk.events.on("workspace.file-change", onFileChange);
		harness.parcel.subscriptions[0]!.emit([{ path: `${PROJECT_A}/src/a.py`, type: "created" }]);

		expect(onFileChange).toHaveBeenCalledTimes(1);
		const payload = onFileChange.mock.calls[0]![0] as unknown;
		expect(payload).toEqual({
			root: PROJECT_A,
			changes: [{ path: `${PROJECT_A}/src/a.py`, type: "create" }],
		});
		// The payload crosses the IPC bridge; it must be structured-cloneable.
		expect(structuredClone(payload)).toEqual(payload);
	});

	it("serves filtered subscriptions through the exposed watcher capability", async () => {
		harness = boot();
		await mainRegister(harness.workspaceSdk, {
			subscribeFn: harness.parcel.subscribe,
			realpath: (p) => p,
		});

		const watcher = harness.workspaceSdk.plugins.get<{
			watcher: WorkspaceWatcherCapability;
		}>("workspace")?.watcher;
		expect(watcher).toBeDefined();

		const received: Array<Array<{ path: string; type: string }>> = [];
		const unsubscribe = watcher!.subscribe(PROJECT_A, { includes: ["**/*.py"] }, (changes) =>
			received.push(changes),
		);
		harness.parcel.subscriptions[0]!.emit([
			{ path: `${PROJECT_A}/a.ts`, type: "created" },
			{ path: `${PROJECT_A}/b.py`, type: "created" },
		]);

		expect(received).toEqual([[{ path: `${PROJECT_A}/b.py`, type: "create" }]]);
		unsubscribe();
	});

	it("exposes actual native watcher readiness through the status channel", async () => {
		let releaseSubscribe!: () => void;
		harness = boot();
		const registered = mainRegister(harness.workspaceSdk, {
			subscribeFn: (dir, onEvents, opts) =>
				new Promise<{ unsubscribe(): Promise<void> }>((resolve) => {
					releaseSubscribe = () => resolve(harness!.parcel.subscribe(dir, onEvents, opts));
				}),
			realpath: (p) => p,
		});
		await tick();

		await expect(harness.workspaceSdk.invoke("status")).resolves.toEqual({
			directories: [{ path: PROJECT_A, state: "starting", subscriberCount: 0 }],
		});

		releaseSubscribe();
		await registered;
		await vi.waitFor(async () => {
			await expect(harness!.workspaceSdk.invoke("status")).resolves.toEqual({
				directories: [{ path: PROJECT_A, state: "active", subscriberCount: 0 }],
			});
		});
	});

	it("reconciles on kilo-ui workspace events: starts new folders and drops removed ones", async () => {
		harness = boot();
		await mainRegister(harness.workspaceSdk, { subscribeFn: harness.parcel.subscribe });

		harness.setWorkspaces([{ folders: [{ path: PROJECT_A }, { path: PROJECT_B }] }]);
		harness.kiloSdk.events.emit("workspace-updated", { before: null, after: null });
		await tick();

		expect(harness.parcel.subscribeAttempts).toEqual([PROJECT_A, PROJECT_B]);

		const onFileChange = vi.fn();
		harness.workspaceSdk.events.on("workspace.file-change", onFileChange);
		const betaSubscription = harness.parcel.subscriptions.find(
			({ directory }) => directory === PROJECT_B,
		)!;
		betaSubscription.emit([{ path: `${PROJECT_B}/c.txt`, type: "created" }]);
		expect(onFileChange).toHaveBeenCalledWith({
			root: PROJECT_B,
			changes: [{ path: `${PROJECT_B}/c.txt`, type: "create" }],
		});

		harness.setWorkspaces([{ folders: [{ path: PROJECT_A }] }]);
		harness.kiloSdk.events.emit("workspace-deleted", { before: null, after: null });
		await tick();

		expect(betaSubscription.unsubscribed).toBe(true);
		expect(
			harness.workspaceSdk.plugins
				.get<{ watcher: WorkspaceWatcherCapability }>("workspace")
				?.watcher.status()
				.directories.map(({ path }) => path),
		).toEqual([PROJECT_A]);
	});

	it("keeps folders from a newer reconcile when an older one finishes last", async () => {
		// The boot reconcile's list() parks on a gate and returns the folders
		// it captured at call time; a workspace event adds PROJECT_B while
		// that stale snapshot is still in flight. Reconciles must serialize,
		// so the older run cannot unwatch what the newer state added.
		let releaseBootList!: () => void;
		const bootListGate = new Promise<void>((resolve) => {
			releaseBootList = resolve;
		});
		let listCalls = 0;
		let folders: { path: string }[] = [{ path: PROJECT_A }];
		harness = boot(undefined, async () => {
			listCalls += 1;
			const snapshot = [{ folders }];
			if (listCalls === 1) await bootListGate;
			return snapshot;
		});

		const registered = mainRegister(harness.workspaceSdk, {
			subscribeFn: harness.parcel.subscribe,
		});
		folders = [{ path: PROJECT_A }, { path: PROJECT_B }];
		harness.kiloSdk.events.emit("workspace-updated", { before: null, after: null });
		releaseBootList();
		await registered;
		await tick();

		const watcher = harness.workspaceSdk.plugins.get<{
			watcher: WorkspaceWatcherCapability;
		}>("workspace")!.watcher;
		expect(watcher.status().directories.map(({ path }) => path)).toEqual([PROJECT_A, PROJECT_B]);
	});

	it("does not wedge the queue when list() rejects — a later event-triggered reconcile still runs", async () => {
		// Boot reconcile's list() rejects; a workspace event afterwards must
		// still trigger a successful reconcile (queue must keep draining).
		let listCalls = 0;
		harness = boot(undefined, async () => {
			listCalls += 1;
			if (listCalls === 1) throw new Error("service temporarily unavailable");
			return [{ folders: [{ path: PROJECT_B }] }];
		});

		await mainRegister(harness.workspaceSdk, { subscribeFn: harness.parcel.subscribe });
		// Boot reconcile failed; nothing subscribed yet.
		expect(harness.parcel.subscribeAttempts).toHaveLength(0);

		harness.kiloSdk.events.emit("workspace-updated", { before: null, after: null });
		await tick();

		// The event-triggered reconcile ran and watched PROJECT_B.
		expect(harness.parcel.subscribeAttempts).toEqual([PROJECT_B]);
	});

	it("re-attempts a failed directory when a workspace event re-lists it", async () => {
		harness = boot();
		harness.parcel.failNextSubscribes(PROJECT_A, 1, new Error("boot race"));
		await mainRegister(harness.workspaceSdk, {
			subscribeFn: harness.parcel.subscribe,
			retryDelayMs: 100,
		});
		await tick(10);

		const watcher = harness.workspaceSdk.plugins.get<{
			watcher: WorkspaceWatcherCapability;
		}>("workspace")!.watcher;
		expect(watcher.status().directories[0]?.state).toBe("retrying");

		// The retry loop resubscribes on its own timer.
		await tick(200);
		expect(watcher.status().directories[0]?.state).toBe("active");
		expect(harness.parcel.subscribeAttempts).toEqual([PROJECT_A, PROJECT_A]);
	});
});
