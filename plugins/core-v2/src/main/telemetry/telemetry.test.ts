import { describe, expect, it, vi } from "vitest";

import {
	definePlugin,
	KernelDataCollection,
	KernelIdentityProvider,
	KernelTelemetry,
	type AccountInput,
	type DomainObjectProvider,
} from "@kilo-desktop/kernel";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";

import manifest from "../../../plugin.json";
import { CORE_DEFINITIONS } from "../../contracts";
import { activateTelemetry } from "./index";
import type { TelemetryProvider } from "./types";

function fakeProvider() {
	return {
		track: vi.fn<TelemetryProvider["track"]>(async () => {}),
		dispose: vi.fn(async () => {}),
	};
}

async function boot(
	options: {
		allowed?: boolean;
		environment?: string;
		provider?: TelemetryProvider;
		primary?: AccountInput | null;
	} = {},
) {
	const provider = options.provider ?? fakeProvider();
	const createProvider = vi.fn(() => provider);
	const kernel = createMainKernel({
		host: createTestHost({ version: "2.0.0" }),
		registrations: [
			{
				manifest,
				definitions: CORE_DEFINITIONS,
				entry: definePlugin({
					activate(sdk) {
						// The account area's identity provider, as kilo.core activates it first.
						sdk.extensions.implement(KernelIdentityProvider, "kilo-account", {
							current: () => options.primary ?? null,
							subscribe: () => () => {},
						});
						activateTelemetry(sdk, { createProvider, appRunId: "run-1" });
					},
				}),
			},
			testPlugin("acme.sessions", {
				manifest: {
					contributes: {
						extensions: { "kernel/telemetry-event": [{ id: "created", name: "Session Created" }] },
					},
				},
				entry: { activate: () => {} },
			}),
		],
	});
	const consent: DomainObjectProvider<typeof KernelDataCollection> =
		kernel.kernelSdk.domainObjects.provide(KernelDataCollection, {
			initialState: {
				choice: options.allowed ?? true,
				allowed: options.allowed ?? true,
				installationId: "install-1",
				environment: options.environment ?? "preview",
			},
			methods: { setChoice: () => {} },
		});
	await kernel.start();
	const track = (event: string, data: Record<string, unknown> = {}) =>
		kernel
			.sdkFor("acme.sessions")
			.domainObjects.get(KernelTelemetry)!
			.methods.track({ event, data });
	return { kernel, provider, consent, track, createProvider };
}

describe("PostHog as a telemetry sink", () => {
	it("sends a declared event with the installation and run ids and the environment", async () => {
		const { provider, track, createProvider } = await boot();

		await track("created", { panes: 2 });

		expect(createProvider).toHaveBeenCalledWith({ appVersion: "2.0.0" });
		expect(provider.track).toHaveBeenCalledWith({
			event: "Session Created",
			data: { panes: 2 },
			installationId: "install-1",
			appRunId: "run-1",
			environment: "preview",
			isEmployee: false,
		});
	});

	it("receives nothing without consent", async () => {
		const { provider, consent, track } = await boot();
		consent.setState({ ...consent.state, allowed: false });

		await track("created");

		expect(provider.track).not.toHaveBeenCalled();
	});

	it("never fails the caller when sending fails", async () => {
		const provider = fakeProvider();
		provider.track.mockRejectedValueOnce(new Error("offline"));
		const { track } = await boot({ provider });

		await expect(track("created")).resolves.toBeUndefined();
	});

	it("attributes events to the primary account, with its cohort", async () => {
		const { provider, track } = await boot({
			primary: {
				id: "ada@anaconda.com",
				email: "ada@anaconda.com",
				name: "Ada Lovelace",
				attributes: { isEmployee: true },
			},
		});

		await track("created");

		const entry = vi.mocked(provider.track).mock.calls[0]![0];
		expect(entry).toMatchObject({
			email: "ada@anaconda.com",
			isEmployee: true,
			cohortId: expect.any(Number),
		});
		expect(JSON.stringify(entry)).not.toContain("Ada Lovelace");
	});

	it("reports that the desktop app started once the window is shown", async () => {
		const { kernel, provider } = await boot();
		expect(provider.track).not.toHaveBeenCalled();

		await kernel.windowShown();

		await vi.waitFor(() =>
			expect(provider.track).toHaveBeenCalledWith(
				expect.objectContaining({
					event: "Desktop Initialized",
					data: expect.objectContaining({
						timestamp: expect.any(Number),
						version: "2.0.0",
						platform: process.platform,
					}),
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
});
