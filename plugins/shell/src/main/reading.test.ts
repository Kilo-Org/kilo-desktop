import { afterEach, describe, expect, it } from "vitest";

import {
	KernelDataCollection,
	KernelTelemetrySink,
	type TelemetryEnvelope,
} from "@kilo-desktop/kernel";
import { createMemoryStorage, testManifest } from "@kilo-desktop/kernel/testing";
import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import { DEFAULT_READING_SETTINGS } from "@kilo-desktop/ui/lib/reading/settings";

import manifest from "../../plugin.json";
import { Reading, ReadingPresets, ReadingUsage, SHELL_DEFINITIONS } from "../contracts";
import { createShellMainEntry } from "./entry";

const hosts: PluginHost[] = [];

afterEach(async () => {
	for (const host of hosts.splice(0)) await host.dispose();
});

const DAY = 24 * 60 * 60_000;

async function boot(
	options: { storage?: ReturnType<typeof createMemoryStorage>; now?: () => number } = {},
) {
	const envelopes: TelemetryEnvelope[] = [];
	const storage = options.storage ?? createMemoryStorage("/data/kilo.shell");
	let presetIds = 0;
	const host = await createPluginHost(
		[
			{
				manifest,
				definitions: SHELL_DEFINITIONS,
				main: createShellMainEntry({
					reading: {
						now: options.now ?? (() => DAY * 10),
						createPresetId: () => `preset-${++presetIds}`,
					},
				}),
				web: { activate: () => {} },
			},
			{
				manifest: testManifest("acme.sink", {
					contributes: { extensions: { "kernel/telemetry-sink": [{ id: "sink" }] } },
				}),
				main: {
					activate: (sdk) => {
						sdk.extensions.implement(KernelTelemetrySink, "sink", {
							deliver: (envelope) => void envelopes.push(envelope),
						});
					},
				},
			},
		],
		{
			mainHostServices: (pluginId) =>
				pluginId === "kilo.shell"
					? { storage }
					: { storage: createMemoryStorage(`/m/${pluginId}`) },
		},
	);
	hosts.push(host);
	host.main.kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: { choice: true, allowed: true, installationId: "i", environment: "preview" },
		methods: { setChoice: () => {} },
	});
	const reading = host.main.kernelSdk.domainObjects.get(Reading)!;
	const usage = host.main.kernelSdk.domainObjects.get(ReadingUsage)!;
	const presets = host.main.kernelSdk.domainObjects.get(ReadingPresets)!;
	const sent = () => envelopes.map(({ name, data }) => ({ name, data }));
	return { host, reading, usage, presets, storage, sent };
}

describe("reading preferences (main)", () => {
	it("starts from the defaults and keeps changes across restarts", async () => {
		const { reading, storage } = await boot();
		expect(reading.getState()).toMatchObject({ themeId: null, textSizeStep: 0, lineSpacing: 1 });

		await reading.methods.update({ themeId: "gruvbox", mode: "light", focus: { dimming: 80 } });
		await reading.methods.update({ textSizeStep: 2 });

		const restarted = await boot({ storage });
		expect(restarted.reading.getState()).toEqual({
			themeId: "gruvbox",
			mode: "light",
			textSizeStep: 2,
			lineSpacing: 1,
			focus: { movesWith: "scroll", dimming: 80 },
		});
	});

	it("resets everything to the defaults", async () => {
		const { reading } = await boot();
		await reading.methods.update({ themeId: "nord", lineSpacing: 3, focus: { movesWith: "keys" } });

		const reset = await reading.methods.reset(undefined);

		expect(reset).toEqual({
			themeId: null,
			mode: "auto",
			textSizeStep: 0,
			lineSpacing: 1,
			focus: { movesWith: "scroll", dimming: 60 },
		});
		expect(reading.getState()).toEqual(reset);
	});

	it("rejects values out of range", async () => {
		const { reading } = await boot();

		await expect(reading.methods.update({ textSizeStep: 9 })).rejects.toThrow();
		await expect(reading.methods.update({ themeId: "solarized" as never })).rejects.toThrow();
	});

	it("reports the preferences once a day, content-free", async () => {
		let now = DAY * 10;
		const storage = createMemoryStorage("/data/kilo.shell");
		const first = await boot({ storage, now: () => now });

		await expect.poll(first.sent).toEqual([
			{
				name: "Reading Preferences Snapshot",
				data: {
					themeId: "app",
					mode: "auto",
					textSizeStep: 0,
					lineSpacing: 1,
					movesWith: "scroll",
					dimming: 60,
					isDefault: true,
				},
			},
		]);
		await first.host.dispose();
		hosts.splice(0);

		now += DAY / 2;
		const sameDay = await boot({ storage, now: () => now });
		// The decision is made at boot: a send would have moved this on.
		expect(storage.saved.get("reading")).toMatchObject({ lastSnapshotAt: DAY * 10 });
		expect(sameDay.sent()).toEqual([]);
	});
});

describe("reading presets (main)", () => {
	const LATE_NIGHT = {
		themeId: "gruvbox",
		mode: "dark",
		textSizeStep: 2,
		lineSpacing: 2,
		focus: { movesWith: "keys", dimming: 80 },
	} as const;

	it("starts empty", async () => {
		const { presets } = await boot();
		expect(presets.getState()).toEqual({ presets: [], activeId: null, defaultId: null });
	});

	it("saves the current settings as the active preset, optionally as the default", async () => {
		const { reading, presets } = await boot();
		await reading.methods.update(LATE_NIGHT);

		const saved = await presets.methods.save({ name: "  Late night ", makeDefault: true });

		expect(saved).toEqual({ id: "preset-1", name: "Late night", settings: LATE_NIGHT });
		expect(presets.getState()).toEqual({
			presets: [saved],
			activeId: "preset-1",
			defaultId: "preset-1",
		});
		await presets.methods.save({ name: "Second" });
		expect(presets.getState().defaultId).toBe("preset-1");
		expect(presets.getState().activeId).toBe("preset-2");
	});

	it("applies a preset to Reading and marks it active", async () => {
		const { reading, presets } = await boot();
		await reading.methods.update(LATE_NIGHT);
		await presets.methods.save({ name: "Late night" });
		await reading.methods.reset(undefined);
		await presets.methods.save({ name: "Daytime" });

		const applied = await presets.methods.apply({ id: "preset-1" });

		expect(applied).toEqual(LATE_NIGHT);
		expect(reading.getState()).toEqual(LATE_NIGHT);
		expect(presets.getState().activeId).toBe("preset-1");
	});

	it("matches Appearance: standard settings and no preset active", async () => {
		const { reading, presets } = await boot();
		await reading.methods.update(LATE_NIGHT);
		await presets.methods.save({ name: "Late night", makeDefault: true });

		const applied = await presets.methods.apply({ id: null });

		expect(applied).toEqual(DEFAULT_READING_SETTINGS);
		expect(reading.getState()).toEqual(DEFAULT_READING_SETTINGS);
		expect(presets.getState()).toMatchObject({ activeId: null, defaultId: "preset-1" });
	});

	it("updates a preset from the current settings", async () => {
		const { reading, presets } = await boot();
		await presets.methods.save({ name: "Late night" });
		await reading.methods.update({ textSizeStep: 3 });

		const updated = await presets.methods.update({ id: "preset-1" });

		expect(updated.settings.textSizeStep).toBe(3);
		expect(presets.getState().presets[0]?.settings.textSizeStep).toBe(3);
	});

	it("renames, refusing a name another preset uses", async () => {
		const { presets } = await boot();
		await presets.methods.save({ name: "Late night" });
		await presets.methods.save({ name: "Daytime" });

		await presets.methods.rename({ id: "preset-1", name: "Big print" });
		await presets.methods.rename({ id: "preset-1", name: "BIG PRINT" });

		expect(presets.getState().presets.map(({ name }) => name)).toEqual(["BIG PRINT", "Daytime"]);
		await expect(presets.methods.rename({ id: "preset-1", name: "daytime" })).rejects.toThrow(
			/already exists/,
		);
		await expect(presets.methods.save({ name: "Daytime" })).rejects.toThrow(/already exists/);
		await expect(presets.methods.save({ name: "   " })).rejects.toThrow();
		await expect(presets.methods.save({ name: "x".repeat(101) })).rejects.toThrow();
	});

	it("removing the active or default preset clears it and keeps the settings", async () => {
		const { reading, presets } = await boot();
		await reading.methods.update(LATE_NIGHT);
		await presets.methods.save({ name: "Late night", makeDefault: true });

		await presets.methods.remove({ id: "preset-1" });

		expect(presets.getState()).toEqual({ presets: [], activeId: null, defaultId: null });
		expect(reading.getState()).toEqual(LATE_NIGHT);
		await expect(presets.methods.apply({ id: "preset-1" })).rejects.toThrow(/not found/);
	});

	it("sets and clears the default", async () => {
		const { presets } = await boot();
		await presets.methods.save({ name: "Late night" });

		await presets.methods.setDefault({ id: "preset-1" });
		expect(presets.getState().defaultId).toBe("preset-1");
		await presets.methods.setDefault({ id: null });
		expect(presets.getState().defaultId).toBeNull();
		await expect(presets.methods.setDefault({ id: "nope" })).rejects.toThrow(/not found/);
	});

	it("refuses more than 100 presets", async () => {
		const { presets } = await boot();
		for (let index = 0; index < 100; index++) await presets.methods.save({ name: `P${index}` });

		await expect(presets.methods.save({ name: "One more" })).rejects.toThrow(/up to 100/);
	});

	it("opens with the default preset, marked active", async () => {
		const storage = createMemoryStorage("/data/kilo.shell");
		const first = await boot({ storage });
		await first.reading.methods.update(LATE_NIGHT);
		await first.presets.methods.save({ name: "Late night", makeDefault: true });
		await first.reading.methods.update({ textSizeStep: 5, themeId: "nord" });
		await first.presets.methods.save({ name: "Other" });

		const restarted = await boot({ storage });

		expect(restarted.reading.getState()).toEqual(LATE_NIGHT);
		expect(restarted.presets.getState().activeId).toBe("preset-1");
	});

	it("without a default, opens with the last settings and the preset active then", async () => {
		const storage = createMemoryStorage("/data/kilo.shell");
		const first = await boot({ storage });
		await first.presets.methods.save({ name: "Late night" });
		await first.reading.methods.update({ textSizeStep: 4 });

		const restarted = await boot({ storage });

		expect(restarted.reading.getState().textSizeStep).toBe(4);
		expect(restarted.presets.getState()).toMatchObject({ activeId: "preset-1", defaultId: null });
	});

	it("ignores corrupt stored presets", async () => {
		const storage = createMemoryStorage("/data/kilo.shell");
		const first = await boot({ storage });
		await first.reading.methods.update({ textSizeStep: 4 });
		await first.host.dispose();
		hosts.splice(0);
		storage.saved.set("reading", {
			...storage.saved.get("reading"),
			presets: { presets: [{ id: 3 }, "junk"], activeId: "gone", defaultId: "gone" },
		});

		const restarted = await boot({ storage });

		expect(restarted.presets.getState()).toEqual({ presets: [], activeId: null, defaultId: null });
		expect(restarted.reading.getState().textSizeStep).toBe(4);
	});
});

describe("reading usage (main)", () => {
	it("falls back field by field when stored usage is damaged", async () => {
		const storage = createMemoryStorage("/data/kilo.shell");
		storage.saved.set("reading", {
			usage: { focusVisits: "3", lastFocusEnteredAt: 2_000, lastFocusExit: { at: 1 } },
		});

		const { usage } = await boot({ storage });

		expect(usage.getState()).toEqual({
			focusVisits: 0,
			lastFocusEnteredAt: 2_000,
			lastFocusExit: null,
		});
	});

	it("skips the daily snapshot when its write fails, without throwing", async () => {
		const storage = createMemoryStorage("/data/kilo.shell");
		const kv = storage.kv.bind(storage);
		storage.kv = (options) => {
			const store = kv(options);
			return {
				...store,
				set: (patch) => {
					if ("lastSnapshotAt" in patch) throw new Error("disk full");
					return store.set(patch);
				},
			};
		};

		const { sent } = await boot({ storage });

		expect(sent()).toEqual([]);
	});

	it("counts Focus visits and remembers the last exit", async () => {
		let now = 1_000;
		const { usage } = await boot({ now: () => now });

		expect(await usage.methods.recordFocusEntered(undefined)).toEqual({
			focusVisits: 0,
			lastFocusEnteredAt: null,
			lastFocusExit: null,
		});
		now = 5_000;
		await usage.methods.recordFocusExited({ workSessionId: "ws1" });
		now = 9_000;
		const before = await usage.methods.recordFocusEntered(undefined);

		expect(before).toEqual({
			focusVisits: 1,
			lastFocusEnteredAt: 1_000,
			lastFocusExit: { at: 5_000, workSessionId: "ws1" },
		});
		expect(usage.getState().focusVisits).toBe(2);
		expect(usage.getState().lastFocusEnteredAt).toBe(9_000);
	});
});
