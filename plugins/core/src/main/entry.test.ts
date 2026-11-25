import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	KernelDataCollection,
	KernelFlags,
	KernelIdentity,
	KernelTelemetry,
} from "@kilo-desktop/kernel";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost } from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import {
	CORE_DEFINITIONS,
	EXTERNAL_AI_APPS_FLAG,
	KILO_TERMS_VERSION,
	KiloAccount,
	KiloServer,
	KiloTerms,
	KiloWorkStyle,
	Models,
	type KiloProfile,
} from "../contracts";
import { cleanUpAgents, eventually, onCleanUp, tempDir } from "../test/agent/boot";
import { FakeKiloChats } from "../test/agent/fake-kilo-chats";
import { FakeServer } from "../test/agent/fake-server";
import type { KiloAccountClient } from "./account";
import { inMemoryTerms } from "./account/terms";
import { createCoreMainEntry } from "./entry";
import { DefaultsOnlyProvider } from "./flags/defaults-provider";
import { createFakeKiloClient } from "./models/test-kilo-client";
import { createFakeWorkStyleClient } from "./work-style/test-work-style-client";

const PROFILE: KiloProfile = {
	email: "ada@example.com",
	organizations: [],
	hasPersonalAccount: true,
	organizationId: null,
	balance: null,
	kiloPass: null,
};

const signedInAccount: KiloAccountClient = {
	authStatus: async () => ({ authenticated: true }),
	profile: async () => PROFILE,
	authorize: async () => ({ url: "https://app.kilo.ai/device" }),
	callback: async () => {},
	signOut: async () => {},
	setOrganization: async () => {},
	dispose: async () => {},
};

afterEach(cleanUpAgents);

/** Boots the real kilo.core entry, every area wired to fakes, the way the app does. */
async function bootCore() {
	const storage = await tempDir("kilo-core-entry-");
	const delivered: string[] = [];
	const models = createFakeKiloClient({
		list: {
			all: [{ id: "kilo", name: "Kilo", source: "api", env: [], models: {} }],
			connected: ["kilo"],
		},
	});
	const entry = createCoreMainEntry({
		account: () => ({
			createClient: () => signedInAccount,
			termsStorage: inMemoryTerms({ version: null, acceptedAt: null, linkedAccounts: [] }),
		}),
		agent: () => ({
			createServer: (input) => new FakeServer(input),
			createChatClient: () => new FakeKiloChats(),
			userConfigDirectory: path.join(storage, "user-config"),
			envRestartDebounceMs: 5,
		}),
		models: () => ({
			createClient: () => models.client,
			fetch: vi.fn(async () => Response.json({ data: [] })),
		}),
		workStyle: () => ({ createClient: () => createFakeWorkStyleClient().client }),
		flags: () => ({ createProvider: () => new DefaultsOnlyProvider() }),
		telemetry: () => ({
			createProvider: () => ({
				track: async ({ event }) => void delivered.push(event),
				dispose: async () => {},
			}),
		}),
	});
	const kernel = createMainKernel({
		host: createTestHost({ rendererOrigins: ["kilo-desktop://app"] }),
		registrations: [{ manifest, definitions: CORE_DEFINITIONS, entry }],
		hostServices: () => ({ storage: createMemoryStorage(storage) }),
	});
	kernel.kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: { choice: true, allowed: true, installationId: "i", environment: "stable" },
		methods: { setChoice: () => {} },
	});
	await kernel.start();
	onCleanUp(() => kernel.stop());
	return { kernel, delivered, get: kernel.kernelSdk.domainObjects };
}

describe("kilo.core", () => {
	it("activates every area together", async () => {
		const { kernel, get } = await bootCore();

		expect(kernel.pluginState("kilo.core")).toBe("active");
		for (const domainObject of [KiloServer, KiloAccount, KiloTerms, Models, KiloWorkStyle]) {
			expect(get.get(domainObject), domainObject.id).not.toBeNull();
		}
		expect(get.get(KernelFlags)!.lookup(EXTERNAL_AI_APPS_FLAG)).toMatchObject({
			pluginId: "kilo.core",
			value: false,
		});
	});

	it("starts the server once terms are accepted, then signs in, lists models and names the user", async () => {
		const { kernel, get } = await bootCore();
		await kernel.windowShown();
		expect(get.get(KiloServer)!.getState().status).not.toBe("ready");

		await get.get(KiloTerms)!.methods.accept({ version: KILO_TERMS_VERSION });

		await eventually(() => expect(get.get(KiloServer)!.getState().status).toBe("ready"));
		await eventually(() => expect(get.get(KiloAccount)!.getState().signedIn).toBe(true));
		await eventually(() => expect(get.get(Models)!.getState().ready).toBe(true));
		await eventually(() =>
			expect(get.get(KernelIdentity)!.getState().primary).toMatchObject({
				email: "ada@example.com",
				source: "kilo.core/kilo-account",
			}),
		);
	});

	it("sends its declared events through its own telemetry sink", async () => {
		const { kernel, delivered, get } = await bootCore();
		await kernel.windowShown();

		await get.get(KiloTerms)!.methods.accept({ version: KILO_TERMS_VERSION });
		await kernel
			.sdkFor("kilo.core")
			.domainObjects.get(KernelTelemetry)!
			.methods.track({ event: "logged-in" });

		await eventually(() =>
			expect(delivered).toEqual(
				expect.arrayContaining(["Desktop Initialized", "Terms Accepted", "Logged In"]),
			),
		);
	});
});
