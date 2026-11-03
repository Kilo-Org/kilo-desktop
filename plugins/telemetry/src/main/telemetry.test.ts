import { describe, expect, it, vi } from "vitest";

import { KernelDataCollection, type DomainProvider } from "@kilo-desktop/kernel";
import {
	Identity,
	KILO_TERMS_URL,
	Terms,
	type IdentityState,
} from "@kilo-desktop/plugin-account/contracts";
import { Onboarding } from "@kilo-desktop/plugin-shell/contracts";
import { Workspaces, type Workspace } from "@kilo-desktop/plugin-workspaces/contracts";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";

import manifest from "../../plugin.json";
import { TELEMETRY_DEFINITIONS, Telemetry } from "../contracts";
import type { TelemetryProvider } from "./types";
import { createTelemetryMainEntry } from "./entry";

function fakeProvider() {
	return {
		track: vi.fn<TelemetryProvider["track"]>(async () => {}),
		dispose: vi.fn(async () => {}),
	};
}

const SIGNED_OUT: IdentityState = {
	connection: "connected",
	authenticated: false,
	profile: null,
	profileError: null,
	deviceAuth: { status: "idle" },
	orgError: null,
	isRefreshing: false,
	isSwitchingOrg: false,
};

/** Stands in for kilo.account and kilo.shell's onboarding: domains whose events the test fires. */
function fakeAppDomains(identity: IdentityState) {
	const providers: {
		identity?: DomainProvider<typeof Identity>;
		terms?: DomainProvider<typeof Terms>;
		onboarding?: DomainProvider<typeof Onboarding>;
		workspaces?: DomainProvider<typeof Workspaces>;
	} = {};
	const noop = () => {};
	return {
		providers,
		registrations: [
			testPlugin("kilo.account", {
				manifest: {
					domains: [
						{ id: "identity", home: "main" },
						{ id: "terms", home: "main" },
					],
				},
				definitions: { domains: [Identity, Terms] },
				entry: {
					activate: (sdk) => {
						providers.identity = sdk.domains.provide(Identity, {
							initialState: identity,
							methods: {
								signIn: async () => ({ signedIn: false }),
								cancelSignIn: noop,
								signOut: noop,
								refresh: noop,
								setOrganization: noop,
								dismissOrgError: noop,
							},
						});
						providers.terms = sdk.domains.provide(Terms, {
							initialState: { version: "2026-09-29", accepted: true, acceptedAt: 0 },
							methods: { accept: () => providers.terms!.state },
						});
					},
				},
			}),
			testPlugin("kilo.workspaces", {
				manifest: { domains: [{ id: "workspace", home: "main" }] },
				definitions: { domains: [Workspaces] },
				entry: {
					activate: (sdk) => {
						providers.workspaces = sdk.domains.provide(Workspaces, {
							initialState: { workspaces: [], activeId: null, unavailableFolderIds: [] },
							methods: {
								create: () => {
									throw new Error("unused");
								},
								update: () => {
									throw new Error("unused");
								},
								remove: () => ({ deleted: false }),
								setActive: noop,
								authorize: () => ({ allowed: false }),
								checkFolders: noop,
							},
						});
					},
				},
			}),
			testPlugin("kilo.shell", {
				manifest: { domains: [{ id: "onboarding", home: "main" }] },
				definitions: { domains: [Onboarding] },
				entry: {
					activate: (sdk) => {
						providers.onboarding = sdk.domains.provide(Onboarding, {
							initialState: { outcome: null, version: null },
							methods: { complete: noop, skip: noop, markShown: noop },
						});
					},
				},
			}),
		],
	};
}

async function boot(
	options: { allowed?: boolean; provider?: TelemetryProvider; identity?: IdentityState } = {},
) {
	const app = fakeAppDomains(options.identity ?? SIGNED_OUT);
	const provider = options.provider ?? fakeProvider();
	const kernel = createMainKernel({
		host: createTestHost({ version: "2.0.0" }),
		registrations: [
			{
				manifest,
				definitions: TELEMETRY_DEFINITIONS,
				entry: createTelemetryMainEntry({ createProvider: () => provider, appRunId: "run-1" }),
			},
			testPlugin("acme.sessions", {
				manifest: {
					contributes: {
						extensions: {
							"kilo.telemetry/telemetry-event": [{ id: "created", name: "Session Created" }],
						},
					},
				},
				entry: { activate: () => {} },
			}),
			testPlugin("acme.other", { entry: { activate: () => {} } }),
			...app.registrations,
		],
	});
	const consent: DomainProvider<typeof KernelDataCollection> = kernel.kernelSdk.domains.provide(
		KernelDataCollection,
		{
			initialState: {
				choice: options.allowed ?? true,
				allowed: options.allowed ?? true,
				installationId: "install-1",
				environment: "preview",
			},
			methods: { setChoice: () => {} },
		},
	);
	await kernel.start();
	const telemetryFor = (pluginId: string) => kernel.sdkFor(pluginId).domains.get(Telemetry)!;
	return { kernel, provider, consent, telemetryFor, app };
}

describe("kilo.telemetry", () => {
	it("sends an event the caller declared, with the installation and run ids", async () => {
		const { provider, telemetryFor } = await boot();

		await telemetryFor("acme.sessions").methods.track({
			event: "Session Created",
			data: { panes: 2 },
		});

		expect(provider.track).toHaveBeenCalledWith({
			event: "Session Created",
			data: { panes: 2 },
			installationId: "install-1",
			appRunId: "run-1",
			isEmployee: false,
		});
	});

	it("sends nothing without consent", async () => {
		const { provider, consent, telemetryFor } = await boot();
		consent.setState({ ...consent.state, allowed: false });

		await telemetryFor("acme.sessions").methods.track({ event: "Session Created" });

		expect(provider.track).not.toHaveBeenCalled();
	});

	it("drops events the caller did not declare, even ones another plugin declared", async () => {
		const { provider, telemetryFor } = await boot();

		await telemetryFor("acme.other").methods.track({ event: "Session Created" });
		await telemetryFor("acme.sessions").methods.track({ event: "Something Else" });

		expect(provider.track).not.toHaveBeenCalled();
	});

	it("never fails the caller when sending fails", async () => {
		const provider = fakeProvider();
		provider.track.mockRejectedValueOnce(new Error("offline"));
		const { telemetryFor } = await boot({ provider });

		await expect(
			telemetryFor("acme.sessions").methods.track({ event: "Session Created" }),
		).resolves.toBeUndefined();
	});

	it("reports that the desktop app started once the window is shown", async () => {
		const { kernel, provider } = await boot();

		await kernel.windowShown();

		await vi.waitFor(() =>
			expect(provider.track).toHaveBeenCalledWith(
				expect.objectContaining({
					event: "Desktop Initialized",
					data: expect.objectContaining({ version: "2.0.0", platform: process.platform }),
				}),
			),
		);
	});

	it("flushes queued events when the app stops", async () => {
		const { kernel, provider } = await boot();
		await kernel.windowShown();

		await kernel.stop();

		expect(provider.dispose).toHaveBeenCalledOnce();
	});

	it("attributes events to the signed-in Kilo account", async () => {
		const { provider, telemetryFor } = await boot({
			identity: {
				...SIGNED_OUT,
				authenticated: true,
				profile: {
					profile: { email: "ada@anaconda.com" },
					balance: null,
					kiloPass: null,
					currentOrgId: null,
				},
			},
		});

		await telemetryFor("acme.sessions").methods.track({ event: "Session Created" });

		expect(provider.track).toHaveBeenCalledWith(
			expect.objectContaining({
				email: "ada@anaconda.com",
				isEmployee: true,
				cohortId: expect.any(Number),
			}),
		);
	});

	it("reports sign-in, sign-out and terms acceptance", async () => {
		const { provider, app } = await boot();

		app.providers.identity!.emit("signed-in", {});
		app.providers.identity!.emit("signed-out", {});
		app.providers.terms!.emit("accepted", { version: "2026-09-29" });
		app.providers.terms!.emit("linked", { version: "2026-09-29" });

		await vi.waitFor(() => expect(provider.track).toHaveBeenCalledTimes(4));
		const events = vi.mocked(provider.track).mock.calls.map(([entry]) => entry.event);
		expect(events).toEqual([
			"Logged In",
			"Logged Out",
			"Terms Accepted",
			"Terms Acceptance Linked",
		]);
		expect(vi.mocked(provider.track).mock.calls[2]![0].data).toEqual({
			termsVersion: "2026-09-29",
			termsUrl: KILO_TERMS_URL,
			$set_once: { terms_accepted_at: new Date(0).toISOString(), terms_version: "2026-09-29" },
		});
	});

	it("reports onboarding being shown, completed and skipped", async () => {
		const { provider, app } = await boot();

		app.providers.onboarding!.emit("shown", {});
		app.providers.onboarding!.emit("completed", {});
		app.providers.onboarding!.emit("skipped", {});

		await vi.waitFor(() => expect(provider.track).toHaveBeenCalledTimes(3));
		expect(vi.mocked(provider.track).mock.calls.map(([entry]) => entry.event)).toEqual([
			"Onboarding Shown",
			"Onboarding Completed",
			"Onboarding Skipped",
		]);
	});

	it("reports workspaces being created and removed, with folder counts only", async () => {
		const { provider, app } = await boot();
		const workspace: Workspace = {
			id: "w1",
			name: "Secret project",
			folders: [
				{ id: "f1", path: "/Users/ada/secret", isPrimary: true, position: 0 },
				{ id: "f2", path: "/Users/ada/docs", isPrimary: false, position: 1 },
			],
			createdAt: 1,
			updatedAt: 1,
		};

		app.providers.workspaces!.emit("created", {
			before: null,
			after: workspace,
			source: "onboarding",
		});
		app.providers.workspaces!.emit("deleted", { before: workspace, after: null });

		await vi.waitFor(() => expect(provider.track).toHaveBeenCalledTimes(2));
		expect(
			vi.mocked(provider.track).mock.calls.map(([entry]) => [entry.event, entry.data]),
		).toEqual([
			["Workspace Created", { source: "onboarding", folderCount: 2 }],
			["Workspace Removed", { folderCount: 2 }],
		]);
	});
});
