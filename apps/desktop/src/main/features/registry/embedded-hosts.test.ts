import { afterEach, describe, expect, it, vi } from "vitest";

import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

const features: FeatureRegistration[] = [];

// The real FEATURES array boots the notebook feature, which reaches for Electron
// and the daemon socket; the collector only needs ids to look up.
vi.mock("./features.js", () => ({
	get FEATURES() {
		return features;
	},
}));

import { collectEmbeddedHosts } from "./embedded-hosts.js";
import { bootFeatures, featureRouter } from "./feature-registry.js";

const disposers: Array<() => void> = [];

// Injected wherever a malformed contribution is expected, so the suite never
// initializes `electron-log` against a mocked Electron.
const silentLogger = { warn: () => undefined };

async function boot(id: string, register: FeatureRegistration["mainRegister"]): Promise<void> {
	const registration = { id, mainRegister: register };
	features.push(registration);
	// `bootFeatures` is async (it awaits async mainRegister), so the disposer has
	// to be awaited out of the promise rather than pushed as one.
	disposers.push(await bootFeatures([registration]));
}

afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
	features.splice(0);
	vi.restoreAllMocks();
});

describe("collectEmbeddedHosts", () => {
	it("collects a contributed host and ignores features that expose nothing", async () => {
		const config = async () => ({ token: "t" });
		await boot("embedded-host-notebook", (sdk) => {
			sdk.plugins.expose("embeddedWebHost", {
				host: "notebook",
				root: "/bundle",
				routes: { "/__nteract_dev_relay/config": config },
			});
		});
		await boot("embedded-host-silent", () => {});

		expect(collectEmbeddedHosts()).toEqual([
			{ host: "notebook", root: "/bundle", routes: { "/__nteract_dev_relay/config": config } },
		]);
	});

	it("accepts a host that ships no bundle, since that is an expected build", async () => {
		await boot("embedded-host-rootless", (sdk) => {
			sdk.plugins.expose("embeddedWebHost", { host: "notebook", root: undefined });
		});

		expect(collectEmbeddedHosts()).toEqual([{ host: "notebook", root: undefined }]);
	});

	it("skips a malformed contribution rather than taking down the protocol handler", async () => {
		await boot("embedded-host-malformed", (sdk) => {
			sdk.plugins.expose("embeddedWebHost", { host: 42, root: "/bundle" });
		});
		await boot("embedded-host-valid", (sdk) => {
			sdk.plugins.expose("embeddedWebHost", { host: "notebook", root: "/bundle" });
		});

		// The handler serves the whole app, so one bad plugin must not throw here.
		expect(collectEmbeddedHosts(silentLogger)).toEqual([{ host: "notebook", root: "/bundle" }]);
	});

	it.each([
		["not an object", "plain-string" as unknown],
		["a null contribution", null],
		["a non-string root", { host: "notebook", root: 7 }],
		["an empty host", { host: "", root: "/bundle" }],
		["null routes", { host: "notebook", root: "/bundle", routes: null }],
	])("rejects %s", async (_label, contribution) => {
		await boot("embedded-host-invalid", (sdk) => {
			sdk.plugins.expose("embeddedWebHost", contribution as Record<string, unknown>);
		});

		expect(collectEmbeddedHosts(silentLogger)).toEqual([]);
	});

	it("rejects routes that are not callable", async () => {
		await boot("embedded-host-bad-routes", (sdk) => {
			sdk.plugins.expose("embeddedWebHost", {
				host: "notebook",
				root: "/bundle",
				routes: { "/config": "not-a-function" },
			});
		});

		expect(collectEmbeddedHosts(silentLogger)).toEqual([]);
	});

	it("sees a host only after its feature boots", async () => {
		// Mirrors the ordering that makes this a thunk: protocol.register runs first.
		expect(collectEmbeddedHosts()).toEqual([]);
		await boot("embedded-host-late", (sdk) => {
			sdk.plugins.expose("embeddedWebHost", { host: "notebook", root: "/bundle" });
		});
		expect(collectEmbeddedHosts()).toHaveLength(1);
	});

	it("drops a host once its feature is destroyed", async () => {
		await boot("embedded-host-transient", (sdk) => {
			sdk.plugins.expose("embeddedWebHost", { host: "notebook", root: "/bundle" });
		});
		expect(collectEmbeddedHosts()).toHaveLength(1);

		featureRouter.destroyFeature("embedded-host-transient");

		expect(collectEmbeddedHosts()).toEqual([]);
	});
});
