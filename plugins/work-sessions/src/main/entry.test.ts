import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { KernelLogger } from "@kilo-desktop/kernel";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost } from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import {
	FileWatcher,
	HAS_VCS_KEY,
	HAS_WORKSPACES_KEY,
	LayoutPresets,
	Panes,
	WORK_SESSIONS_DEFINITIONS,
	WorkSessions,
	Workspaces,
} from "../contracts";
import { workSessionsMainEntry } from "./index";
import { FakeCore } from "./test-boot";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "kilo-work-sessions-entry-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function recordingLogger() {
	const errors: unknown[][] = [];
	const logger: KernelLogger = {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: (...args) => void errors.push(args),
	};
	return { logger, errors };
}

/** Boots the production entry the way the host's removability test does: test host, nothing else. */
async function bootProduction(withCore: boolean) {
	const { logger, errors } = recordingLogger();
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			...(withCore ? [new FakeCore().registration] : []),
			{ manifest, definitions: WORK_SESSIONS_DEFINITIONS, entry: workSessionsMainEntry },
		],
		hostServices: () => ({ storage: createMemoryStorage(path.join(root, "kilo.work-sessions")) }),
		logger,
	});
	await kernel.start();
	return { kernel, errors };
}

describe("kilo.work-sessions in main", () => {
	it.each([true, false])(
		"activates every area cleanly, with kilo.core present: %s",
		async (withCore) => {
			const { kernel, errors } = await bootProduction(withCore);
			const get = kernel.kernelSdk.domainObjects;

			expect(kernel.pluginState("kilo.work-sessions")).toBe("active");
			for (const domainObject of [Workspaces, FileWatcher, WorkSessions, Panes, LayoutPresets]) {
				expect(get.get(domainObject), domainObject.id).not.toBeNull();
			}
			expect(kernel.kernelSdk.context.get(HAS_WORKSPACES_KEY)).toBe(false);
			expect(kernel.kernelSdk.context.get(HAS_VCS_KEY)).toBe(false);
			await get.get(Workspaces)!.methods.checkFolders(undefined);
			expect(errors).toEqual([]);
			await kernel.stop();
		},
	);
});
