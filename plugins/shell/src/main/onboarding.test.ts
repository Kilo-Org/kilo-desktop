import { afterEach, describe, expect, it, vi } from "vitest";

import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost } from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import { ONBOARDING_VERSION, Onboarding, SHELL_DEFINITIONS } from "../contracts";
import { createShellMainEntry, shellMainEntry } from "./index";

afterEach(() => {
	vi.unstubAllEnvs();
});

async function boot(
	storage = createMemoryStorage("/data/kilo.shell"),
	readOriginOnboarding?: () => string | null,
) {
	const entry = readOriginOnboarding
		? createShellMainEntry({ readOriginOnboarding })
		: shellMainEntry;
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [{ manifest, definitions: SHELL_DEFINITIONS, entry }],
		hostServices: () => ({ storage }),
	});
	await kernel.start();
	const onboarding = kernel.kernelSdk.domainObjects.get(Onboarding)!;
	const events: string[] = [];
	onboarding.on("shown", () => events.push("shown"));
	onboarding.on("completed", () => events.push("completed"));
	onboarding.on("skipped", () => events.push("skipped"));
	return { kernel, onboarding, events, storage };
}

describe("onboarding outcome", () => {
	it("starts unfinished and remembers completion across launches", async () => {
		const storage = createMemoryStorage("/data/kilo.shell");
		const { onboarding, events } = await boot(storage);
		expect(onboarding.getState()).toEqual({ outcome: null, version: null });

		await onboarding.methods.markShown(undefined);
		await onboarding.methods.complete(undefined);

		expect(onboarding.getState()).toEqual({ outcome: "completed", version: ONBOARDING_VERSION });
		expect(events).toEqual(["shown", "completed"]);
		const relaunched = await boot(storage);
		expect(relaunched.onboarding.getState().outcome).toBe("completed");
	});

	it("records a skip", async () => {
		const { onboarding, events } = await boot();

		await onboarding.methods.skip(undefined);

		expect(onboarding.getState()).toEqual({ outcome: "skipped", version: ONBOARDING_VERSION });
		expect(events).toEqual(["skipped"]);
	});

	it("keeps the outcome origin's kilo-ui saved, once", async () => {
		const storage = createMemoryStorage("/data/kilo.shell");
		const origin = { outcome: "completed", closedAt: 5, version: ONBOARDING_VERSION };
		const { onboarding } = await boot(storage, () => JSON.stringify(origin));

		expect(onboarding.getState()).toEqual({ outcome: "completed", version: ONBOARDING_VERSION });
		await onboarding.methods.skip(undefined);
		const relaunched = await boot(storage, () => JSON.stringify(origin));
		expect(relaunched.onboarding.getState().outcome).toBe("skipped");
	});

	it("keeps an unversioned origin outcome as version 1, so newer onboarding still shows", async () => {
		const origin = { outcome: "skipped", closedAt: 5 };
		const { onboarding } = await boot(undefined, () => JSON.stringify(origin));

		expect(onboarding.getState()).toEqual({ outcome: "skipped", version: null });
	});

	it("tries origin's outcome again next launch when it can't be read", async () => {
		const storage = createMemoryStorage("/data/kilo.shell");
		const first = await boot(storage, () => {
			throw new Error("EBUSY");
		});
		expect(first.onboarding.getState().outcome).toBeNull();

		const origin = { outcome: "completed", closedAt: 5, version: ONBOARDING_VERSION };
		const second = await boot(storage, () => JSON.stringify(origin));

		expect(second.onboarding.getState().outcome).toBe("completed");
	});

	it("counts as skipped for packaged e2e runs without writing the profile", async () => {
		vi.stubEnv("KILO_SKIP_ONBOARDING", "1");
		const { onboarding, storage } = await boot();

		expect(onboarding.getState()).toEqual({ outcome: "skipped", version: ONBOARDING_VERSION });
		expect(storage.saved.has("onboarding")).toBe(false);
	});
});
