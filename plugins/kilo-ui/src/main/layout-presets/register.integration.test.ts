import { afterEach, describe, expect, it, vi } from "vitest";

import { FeatureError, type KvStoreFactory } from "@kilo-desktop/feature-sdk";
import { createFakeMainSdk, type FakeMainSdk } from "@kilo-desktop/testing";

import type { LayoutPresetsState, LayoutTemplate } from "../../contracts/layout-presets/schemas.js";
import { registerLayoutPresets } from "./register.js";

const template: LayoutTemplate = {
	version: 1,
	arrangement: "tiles",
	activePaneId: "chat",
	slots: [
		{ id: "chat", type: "chat" },
		{ id: "files", type: "files" },
	],
	groups: [
		{ id: "primary", tabs: ["chat", "files"], activePaneId: "chat", width: 600, pinned: false },
	],
};

const stackedTemplate: LayoutTemplate = {
	...template,
	groups: [
		{
			id: "top",
			tabs: ["chat"],
			activePaneId: "chat",
			width: 600,
			pinned: true,
			stackId: "stack",
			stackWeight: 0.4,
		},
		{
			id: "bottom",
			tabs: ["files"],
			activePaneId: "files",
			width: 600,
			pinned: true,
			stackId: "stack",
			stackWeight: 0.6,
		},
	],
};

function persistentStorage(seed?: Record<string, unknown>): KvStoreFactory {
	const stores = new Map<string, Record<string, unknown>>();
	if (seed) stores.set("layout-presets", seed);
	return (options) => {
		const namespace = options.namespace ?? "default";
		if (!stores.has(namespace)) stores.set(namespace, structuredClone(options.defaults));
		return {
			snapshot: () => structuredClone(stores.get(namespace)) as typeof options.defaults,
			get: (key) =>
				structuredClone(
					stores.get(namespace)?.[String(key)],
				) as (typeof options.defaults)[typeof key],
			set: (patch) => {
				const next = { ...stores.get(namespace), ...structuredClone(patch) };
				stores.set(namespace, next);
				return structuredClone(next) as typeof options.defaults;
			},
			clear: () => {
				stores.set(namespace, structuredClone(options.defaults));
			},
		};
	};
}

describe("layout preset SDK persistence", () => {
	const sdks: FakeMainSdk[] = [];
	afterEach(() => {
		for (const sdk of sdks.splice(0)) sdk.dispose();
	});

	function boot(createKvStore = persistentStorage()) {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui", createKvStore });
		registerLayoutPresets(sdk);
		sdks.push(sdk);
		return sdk;
	}

	it("saves a default, broadcasts the committed state, and reloads after registration restarts", async () => {
		const storage = persistentStorage();
		const sdk = boot(storage);
		const changed = vi.fn();
		sdk.events.on("kilo-ui.layout-presets-changed", changed);
		await expect(sdk.invoke("layoutPresets.get")).resolves.toEqual({
			presets: [],
			defaultPresetId: null,
		});
		const saved = (await sdk.invoke("layoutPresets.save", {
			name: "  Focus  ",
			template,
			makeDefault: true,
		})) as LayoutPresetsState;
		const id = saved.presets[0]!.id;
		expect(id).toEqual(expect.any(String));
		expect(saved).toEqual({ presets: [{ id, name: "Focus", template }], defaultPresetId: id });
		expect(changed).toHaveBeenCalledExactlyOnceWith(undefined);
		sdk.dispose();
		await expect(boot(storage).invoke("layoutPresets.get")).resolves.toEqual(saved);
	});

	it("updates, renames, selects and removes presets without implicitly changing the default", async () => {
		const sdk = boot();
		const first = (await sdk.invoke("layoutPresets.save", {
			name: "First",
			template,
			makeDefault: true,
		})) as LayoutPresetsState;
		const id = first.presets[0]!.id;
		const second = (await sdk.invoke("layoutPresets.save", {
			name: "Second",
			template,
		})) as LayoutPresetsState;
		const otherId = second.presets[1]!.id;
		const updatedTemplate = {
			...template,
			arrangement: "carousel",
			activePaneId: "files",
			slots: [{ id: "files", type: "files" }],
			groups: [{ ...template.groups[0]!, tabs: ["files"], activePaneId: "files" }],
		};
		const changed = vi.fn();
		sdk.events.on("kilo-ui.layout-presets-changed", changed);
		await expect(
			sdk.invoke("layoutPresets.save", {
				id,
				name: "Updated",
				template: updatedTemplate,
				makeDefault: false,
			}),
		).resolves.toEqual({
			presets: [
				{ id, name: "Updated", template: updatedTemplate },
				{ id: otherId, name: "Second", template },
			],
			defaultPresetId: id,
		});
		await sdk.invoke("layoutPresets.rename", { id: otherId, name: "  Renamed  " });
		await sdk.invoke("layoutPresets.setDefault", { id: otherId });
		await expect(sdk.invoke("layoutPresets.remove", { id })).resolves.toEqual({
			presets: [{ id: otherId, name: "Renamed", template }],
			defaultPresetId: otherId,
		});
		await expect(sdk.invoke("layoutPresets.setDefault", { id: null })).resolves.toMatchObject({
			defaultPresetId: null,
		});
		await sdk.invoke("layoutPresets.save", {
			id: otherId,
			name: "Renamed",
			template,
			makeDefault: true,
		});
		await expect(sdk.invoke("layoutPresets.remove", { id: otherId })).resolves.toEqual({
			presets: [],
			defaultPresetId: null,
		});
		expect(changed).toHaveBeenCalledTimes(7);
	});

	it("rejects unknown preset IDs without writing or broadcasting", async () => {
		const sdk = boot();
		const changed = vi.fn();
		sdk.events.on("kilo-ui.layout-presets-changed", changed);
		for (const [channel, input] of [
			["layoutPresets.save", { id: "missing", name: "Missing", template }],
			["layoutPresets.rename", { id: "missing", name: "Missing" }],
			["layoutPresets.remove", { id: "missing" }],
			["layoutPresets.setDefault", { id: "missing" }],
		] as const) {
			await expect(sdk.invoke(channel, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
			await expect(sdk.invoke(channel, input)).rejects.toBeInstanceOf(FeatureError);
		}
		expect(changed).not.toHaveBeenCalled();
		await expect(sdk.invoke("layoutPresets.get")).resolves.toEqual({
			presets: [],
			defaultPresetId: null,
		});
	});

	it("rejects invalid topology without changing a saved layout", async () => {
		const sdk = boot();
		const saved = await sdk.invoke("layoutPresets.save", { name: "Valid", template });
		const changed = vi.fn();
		sdk.events.on("kilo-ui.layout-presets-changed", changed);
		const group = template.groups[0]!;
		const top = stackedTemplate.groups[0]!;
		const bottom = stackedTemplate.groups[1]!;
		const invalidTemplates = [
			{ ...template, slots: [...template.slots, template.slots[0]!] },
			{ ...stackedTemplate, groups: [top, { ...bottom, id: top.id }] },
			{ ...template, groups: [{ ...group, tabs: ["chat", "missing"] }] },
			{ ...template, groups: [{ ...group, tabs: ["chat", "chat", "files"] }] },
			{ ...template, groups: [{ ...group, tabs: ["chat"] }] },
			{ ...template, groups: [{ ...group, activePaneId: "missing" }] },
			{ ...stackedTemplate, groups: [top, { ...bottom, tabs: ["files", "chat"] }] },
			{ ...template, groups: [{ ...group, stackWeight: 1 }] },
			{ ...template, groups: [{ ...group, stackId: "alone", stackWeight: 1 }] },
			{ ...stackedTemplate, groups: [top, { ...bottom, stackWeight: 0.4 }] },
			{ ...stackedTemplate, groups: [top, { ...bottom, stackWeight: undefined }] },
			{ ...stackedTemplate, groups: [top, { ...bottom, pinned: false }] },
			{
				...stackedTemplate,
				slots: [...template.slots, { id: "terminal", type: "terminal" }],
				groups: [
					top,
					{ id: "middle", tabs: ["terminal"], activePaneId: "terminal", width: 500, pinned: false },
					bottom,
				],
			},
		];
		for (const invalid of invalidTemplates) {
			await expect(
				sdk.invoke("layoutPresets.save", { name: "Invalid", template: invalid }),
			).rejects.toMatchObject({ code: "VALIDATION" });
		}
		expect(changed).not.toHaveBeenCalled();
		await expect(sdk.invoke("layoutPresets.get")).resolves.toEqual(saved);
	});

	it("rejects multiple chat slots without writing or broadcasting", async () => {
		const sdk = boot();
		const saved = await sdk.invoke("layoutPresets.save", { name: "Valid", template });
		const changed = vi.fn();
		sdk.events.on("kilo-ui.layout-presets-changed", changed);
		const invalid = {
			...template,
			slots: [
				{ id: "chat", type: "chat" },
				{ id: "files", type: "chat" },
			],
		};
		await expect(
			sdk.invoke("layoutPresets.save", { name: "Invalid", template: invalid }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(changed).not.toHaveBeenCalled();
		await expect(sdk.invoke("layoutPresets.get")).resolves.toEqual(saved);
	});

	it.each(["bad stack", " stack", "stack ", "stack/other", "stack.other", "", "x".repeat(129)])(
		"rejects parser-incompatible stack ID %j without writing or broadcasting",
		async (stackId) => {
			const sdk = boot();
			const saved = await sdk.invoke("layoutPresets.save", {
				name: "Valid",
				template: stackedTemplate,
			});
			const changed = vi.fn();
			sdk.events.on("kilo-ui.layout-presets-changed", changed);
			await expect(
				sdk.invoke("layoutPresets.save", {
					name: "Invalid",
					template: {
						...stackedTemplate,
						groups: stackedTemplate.groups.map((group) => ({ ...group, stackId })),
					},
				}),
			).rejects.toMatchObject({ code: "VALIDATION" });
			expect(changed).not.toHaveBeenCalled();
			await expect(sdk.invoke("layoutPresets.get")).resolves.toEqual(saved);
		},
	);

	it("round-trips weighted and equal stacks, empty layouts, and every supported pane type", async () => {
		const sdk = boot();
		for (const valid of [
			stackedTemplate,
			...["A0:z_-", "x".repeat(128)].map((stackId) => ({
				...stackedTemplate,
				groups: stackedTemplate.groups.map((group) => ({ ...group, stackId })),
			})),
			{
				...stackedTemplate,
				groups: stackedTemplate.groups.map(({ stackWeight: _weight, ...group }) => group),
			},
			{ ...template, activePaneId: undefined, slots: [], groups: [] },
			{
				...template,
				activePaneId: "terminal",
				slots: [
					{ id: "changes", type: "changes" },
					{ id: "terminal", type: "terminal" },
				],
				groups: [
					{ ...template.groups[0]!, tabs: ["changes", "terminal"], activePaneId: "terminal" },
				],
			},
		]) {
			const saved = (await sdk.invoke("layoutPresets.save", {
				name: "Valid",
				template: valid,
			})) as LayoutPresetsState;
			expect(saved.presets.at(-1)!.template).toEqual(valid);
		}
	});

	it("rejects out-of-bounds and unsupported input at the handler boundary", async () => {
		const sdk = boot();
		const group = template.groups[0]!;
		for (const input of [
			{ name: " " },
			{ name: "x".repeat(101) },
			{ id: "x".repeat(129) },
			{ template: { ...template, version: 2 } },
			{ template: { ...template, arrangement: "unknown" } },
			{ template: { ...template, slots: [{ id: "chat", type: "notebook" }] } },
			{
				template: {
					...template,
					slots: Array.from({ length: 65 }, (_, id) => ({ id: String(id), type: "files" })),
				},
			},
			{ template: { ...template, groups: Array.from({ length: 65 }, () => group) } },
			{
				template: {
					...template,
					groups: [{ ...group, tabs: Array.from({ length: 65 }, () => "chat") }],
				},
			},
			...[-1, 0, 100_001, Infinity, NaN].map((width) => ({
				template: { ...template, groups: [{ ...group, width }] },
			})),
			...[-1, 0, 1.1, Infinity, NaN].map((stackWeight) => ({
				template: {
					...stackedTemplate,
					groups: [{ ...stackedTemplate.groups[0]!, stackWeight }, stackedTemplate.groups[1]!],
				},
			})),
		]) {
			await expect(
				sdk.invoke("layoutPresets.save", { name: "Invalid", template, ...input }),
			).rejects.toMatchObject({ code: "VALIDATION" });
		}
		await expect(sdk.invoke("layoutPresets.get")).resolves.toEqual({
			presets: [],
			defaultPresetId: null,
		});
	});

	it("recovers corrupt or unsupported stored data and can save a new valid layout", async () => {
		const preset = { id: "saved", name: "Saved", template };
		for (const seed of [
			{ version: 2, state: { presets: [preset], defaultPresetId: null } },
			{ version: 1, state: null },
			{ version: 1, state: { presets: [preset], defaultPresetId: "missing" } },
			{ version: 1, state: { presets: [preset, preset], defaultPresetId: null } },
			{
				version: 1,
				state: {
					presets: [{ ...preset, template: { ...template, groups: [] } }],
					defaultPresetId: null,
				},
			},
		]) {
			const storage = persistentStorage(seed);
			const sdk = boot(storage);
			const changed = vi.fn();
			sdk.events.on("kilo-ui.layout-presets-changed", changed);
			await expect(sdk.invoke("layoutPresets.get")).resolves.toEqual({
				presets: [],
				defaultPresetId: null,
			});
			expect(changed).not.toHaveBeenCalled();
			const saved = await sdk.invoke("layoutPresets.save", { name: "Recovered", template });
			sdk.dispose();
			await expect(boot(storage).invoke("layoutPresets.get")).resolves.toEqual(saved);
		}
	});

	it("enforces the preset limit before committing while still allowing updates at capacity", async () => {
		const storage = persistentStorage({
			version: 1,
			state: {
				presets: Array.from({ length: 100 }, (_, index) => ({
					id: `preset-${index}`,
					name: `Preset ${index}`,
					template,
				})),
				defaultPresetId: "preset-0",
			},
		});
		const sdk = boot(storage);
		const changed = vi.fn();
		sdk.events.on("kilo-ui.layout-presets-changed", changed);
		await expect(
			sdk.invoke("layoutPresets.save", { name: "Overflow", template }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(changed).not.toHaveBeenCalled();
		const updated = (await sdk.invoke("layoutPresets.save", {
			id: "preset-0",
			name: "Updated",
			template,
		})) as LayoutPresetsState;
		expect(updated.presets).toHaveLength(100);
		expect(updated.presets[0]!.name).toBe("Updated");
		expect(updated.defaultPresetId).toBe("preset-0");
	});

	it("reports failed storage writes without broadcasting or changing state", async () => {
		const storage = persistentStorage();
		let failWrites = false;
		const sdk = boot((options) => {
			const store = storage(options);
			return {
				...store,
				set: (patch) => {
					if (failWrites) throw new Error("Disk unavailable");
					return store.set(patch);
				},
			};
		});
		const saved = await sdk.invoke("layoutPresets.save", { name: "Saved", template });
		const changed = vi.fn();
		sdk.events.on("kilo-ui.layout-presets-changed", changed);
		failWrites = true;
		await expect(
			sdk.invoke("layoutPresets.save", { name: "Lost", template }),
		).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Could not save layout presets. Please try again.",
		});
		expect(changed).not.toHaveBeenCalled();
		await expect(sdk.invoke("layoutPresets.get")).resolves.toEqual(saved);
	});
});
