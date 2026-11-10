import { realpath as realpathCallback } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import parcelWatcher from "@parcel/watcher";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KernelServices } from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost } from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import { Files, Workspaces, WORKSPACES_DEFINITIONS, type FileChangeEvent } from "../contracts";
import { createWorkspacesMainEntry } from "./entry";

let root: string;
let kernel: MainKernel | undefined;

beforeEach(async () => {
	root = await realpath(await mkdtemp(path.join(tmpdir(), "kilo-watcher-")));
});

afterEach(async () => {
	await kernel?.stop();
	kernel = undefined;
	await rm(root, { recursive: true, force: true });
});

async function boot() {
	kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			{
				manifest,
				definitions: WORKSPACES_DEFINITIONS,
				entry: createWorkspacesMainEntry({
					watch: {
						subscribeFn: (dir, onEvents, options) =>
							parcelWatcher.subscribe(dir, onEvents, options),
						realpath: promisify(realpathCallback.native),
						retryDelayMs: 50,
					},
				}),
			},
		],
		hostServices: () => ({ storage: createMemoryStorage("/data/kilo.workspaces") }),
	});
	await kernel.start();
	const changes: FileChangeEvent[] = [];
	kernel.kernelSdk.domains.get(Files)!.on("changed", (event) => changes.push(event));
	return {
		kernel,
		workspaces: kernel.kernelSdk.domains.get(Workspaces)!,
		files: kernel.kernelSdk.domains.get(Files)!,
		changes,
	};
}

describe("workspace file watcher", () => {
	it("watches every workspace folder once the window shows and reports changes", async () => {
		const app = path.join(root, "app");
		await mkdir(app);
		const booted = await boot();
		await booted.workspaces.methods.create({ folders: [{ path: app, isPrimary: true }] });

		await booted.kernel.windowShown();
		await vi.waitFor(
			() => expect(booted.files.getState().watched).toEqual([{ path: app, state: "active" }]),
			{ timeout: 5_000 },
		);
		await writeFile(path.join(app, "hello.txt"), "hi");

		await vi.waitFor(
			() =>
				expect(booted.changes).toContainEqual({
					root: app,
					changes: expect.arrayContaining([
						{ path: path.join(app, "hello.txt"), type: expect.stringMatching(/create|update/) },
					]),
				}),
			{ timeout: 5_000 },
		);
		expect(
			booted.kernel.kernelSdk.domains.get(KernelServices)!.getState().services[
				"kilo.workspaces/watcher"
			]?.status,
		).toBe("ready");
	});

	it("follows workspaces being added, changed and removed", async () => {
		const app = path.join(root, "app");
		const docs = path.join(root, "docs");
		await mkdir(app);
		await mkdir(docs);
		const booted = await boot();
		await booted.kernel.windowShown();

		const created = await booted.workspaces.methods.create({
			folders: [{ path: app, isPrimary: true }],
		});
		await vi.waitFor(() => expect(booted.files.getState().watched).toHaveLength(1), {
			timeout: 5_000,
		});
		await booted.workspaces.methods.update({
			id: created.id,
			folders: [
				{ path: app, isPrimary: true },
				{ path: docs, isPrimary: false },
			],
		});
		await vi.waitFor(
			() =>
				expect(
					booted.files
						.getState()
						.watched.map((folder) => folder.path)
						.sort(),
				).toEqual([app, docs].sort()),
			{ timeout: 5_000 },
		);

		await booted.workspaces.methods.remove({ id: created.id });

		await vi.waitFor(() => expect(booted.files.getState().watched).toEqual([]), {
			timeout: 5_000,
		});
	});

	// Repro for the WSL report. Set KILO_TEST_WSL_DIR to an existing folder
	// inside a running distro, e.g. \\wsl.localhost\Ubuntu\home\<user>\repro.
	// Parcel resolves subscribe() there and then errors "Failed to read
	// changes" via the callback; with retryDelayMs 50 and the default 5
	// retries the watcher must settle on "failed" instead of retrying forever.
	const wslDir = process.env.KILO_TEST_WSL_DIR;
	it.skipIf(process.platform !== "win32" || !wslDir)(
		"stops retrying a \\\\wsl.localhost workspace folder",
		async () => {
			const subscribeSpy = vi.spyOn(parcelWatcher, "subscribe");
			try {
				const booted = await boot();
				await booted.workspaces.methods.create({ folders: [{ path: wslDir!, isPrimary: true }] });
				await booted.kernel.windowShown();

				await vi.waitFor(
					() =>
						expect(booted.files.getState().watched).toEqual([{ path: wslDir, state: "failed" }]),
					{ timeout: 5_000 },
				);
				const attempts = subscribeSpy.mock.calls.length;
				// Initial attempt + 5 retries, and no further attempts afterwards.
				expect(attempts).toBe(6);
				await new Promise((resolve) => setTimeout(resolve, 500));
				expect(subscribeSpy.mock.calls.length).toBe(attempts);
			} finally {
				subscribeSpy.mockRestore();
			}
		},
		10_000,
	);
});
