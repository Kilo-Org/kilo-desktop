import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";

import type { LayoutTemplate } from "../../contracts";
import { bootWorkSessions } from "../test-boot";

const TEMPLATE: LayoutTemplate = {
	version: 2,
	arrangement: "tiles",
	slots: [
		{ id: "slot-1", kind: "kilo.chat/agent" },
		{ id: "slot-2", kind: "kilo.terminal/terminal" },
	],
	groups: [
		{ id: "g1", tabs: ["slot-1"], activePaneId: "slot-1", width: 480, pinned: false },
		{ id: "g2", tabs: ["slot-2"], activePaneId: "slot-2", width: 360, pinned: false },
	],
};

async function boot(
	options: {
		origin?: unknown;
		originFile?: string;
		storage?: ReturnType<typeof createMemoryStorage>;
	} = {},
) {
	let id = 0;
	const dir = await mkdtemp(path.join(tmpdir(), "layouts-"));
	const originFile = options.originFile ?? path.join(dir, "layout-presets.json");
	if (options.origin !== undefined) {
		await writeFile(
			originFile,
			typeof options.origin === "string" ? options.origin : JSON.stringify(options.origin),
		);
	}
	const storage = options.storage ?? createMemoryStorage("/data/kilo.work-sessions");
	const booted = await bootWorkSessions({
		storage,
		core: false,
		options: {
			layoutPresets: () => ({ originLayouts: originFile, createId: () => `preset-${++id}` }),
		},
	});
	return { layouts: booted.layoutPresets(), storage };
}

describe("layout presets", () => {
	it("saves, renames, defaults and removes presets, keeping them across restarts", async () => {
		const { layouts, storage } = await boot();

		const code = await layouts.methods.save({
			name: "Code",
			template: TEMPLATE,
			makeDefault: true,
		});
		await layouts.methods.save({ name: "Review", template: TEMPLATE });
		await layouts.methods.rename({ id: code.id, name: "Coding" });
		await layouts.methods.save({
			id: code.id,
			name: "Coding",
			template: { ...TEMPLATE, arrangement: "carousel" },
		});

		expect(layouts.getState()).toMatchObject({
			presets: [
				{ id: "preset-1", name: "Coding", template: { arrangement: "carousel" } },
				{ id: "preset-2", name: "Review" },
			],
			defaultPresetId: "preset-1",
		});

		await layouts.methods.remove({ id: "preset-1" });
		const restarted = await boot({ storage });
		expect(restarted.layouts.getState()).toMatchObject({
			presets: [{ id: "preset-2" }],
			defaultPresetId: null,
		});
		await restarted.layouts.methods.setDefault({ id: "preset-2" });
		expect(restarted.layouts.getState().defaultPresetId).toBe("preset-2");
		await restarted.layouts.methods.setDefault({ id: null });
		expect(restarted.layouts.getState().defaultPresetId).toBeNull();
		await expect(layouts.methods.rename({ id: "gone", name: "x" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(layouts.methods.setDefault({ id: "gone" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("refuses templates that don't hold together", async () => {
		const { layouts } = await boot();

		await expect(
			layouts.methods.save({
				name: "Broken",
				template: { ...TEMPLATE, groups: [TEMPLATE.groups[0]!] },
			}),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("adopts origin's presets once, mapping slot types to pane kinds", async () => {
		const v1 = (slots: { id: string; type: string }[]) => ({
			version: 1,
			arrangement: "tiles",
			slots,
			groups: slots.map((slot, index) => ({
				id: `g${index}`,
				tabs: [slot.id],
				activePaneId: slot.id,
				width: 400,
				pinned: false,
			})),
		});
		const { layouts, storage } = await boot({
			origin: {
				version: 1,
				state: {
					presets: [
						{
							id: "a",
							name: "Code",
							template: v1([
								{ id: "s1", type: "chat" },
								{ id: "s2", type: "terminal" },
							]),
						},
						{ id: "b", name: "Odd", template: v1([{ id: "s1", type: "mystery" }]) },
					],
					defaultPresetId: "a",
				},
			},
		});

		expect(layouts.getState()).toEqual({
			presets: [
				{
					id: "a",
					name: "Code",
					template: expect.objectContaining({
						version: 2,
						slots: [
							{ id: "s1", kind: "kilo.chat/agent" },
							{ id: "s2", kind: "kilo.terminal/terminal" },
						],
					}),
				},
			],
			defaultPresetId: "a",
		});
		await layouts.methods.remove({ id: "a" });
		const again = await boot({
			storage,
			origin: { version: 1, state: { presets: [], defaultPresetId: null } },
		});
		expect(again.layouts.getState().presets).toEqual([]);
	});

	it("starts empty when origin's file is missing or unreadable", async () => {
		const missing = await boot();
		const unreadable = await boot({ origin: "{nope" });
		const unknownVersion = await boot({ origin: { version: 9, state: {} } });

		for (const { layouts } of [missing, unreadable, unknownVersion]) {
			expect(layouts.getState()).toEqual({ presets: [], defaultPresetId: null });
		}
	});

	it("tries origin's presets again next launch when the file can't be read", async () => {
		const storage = createMemoryStorage("/data/kilo.work-sessions");
		const originFile = path.join(await mkdtemp(path.join(tmpdir(), "layouts-")), "presets.json");
		await mkdir(originFile);
		const blocked = await boot({ storage, originFile });
		expect(blocked.layouts.getState().presets).toEqual([]);

		await rm(originFile, { recursive: true });
		const template = {
			version: 1,
			arrangement: "tiles",
			slots: [{ id: "s1", type: "chat" }],
			groups: [{ id: "g1", tabs: ["s1"], activePaneId: "s1", width: 400, pinned: false }],
		};
		const again = await boot({
			storage,
			originFile,
			origin: { version: 1, state: { presets: [{ id: "a", name: "Code", template }] } },
		});

		expect(again.layouts.getState().presets.map(({ id }) => id)).toEqual(["a"]);
	});

	it("adds origin's presets to ones saved here while its file couldn't be read", async () => {
		const storage = createMemoryStorage("/data/kilo.work-sessions");
		const originFile = path.join(await mkdtemp(path.join(tmpdir(), "layouts-")), "presets.json");
		await mkdir(originFile);
		const blocked = await boot({ storage, originFile });
		await blocked.layouts.methods.save({ name: "Mine", template: TEMPLATE, makeDefault: true });

		await rm(originFile, { recursive: true });
		const template = {
			version: 1,
			arrangement: "tiles",
			slots: [{ id: "s1", type: "chat" }],
			groups: [{ id: "g1", tabs: ["s1"], activePaneId: "s1", width: 400, pinned: false }],
		};
		const again = await boot({
			storage,
			originFile,
			origin: {
				version: 1,
				state: {
					presets: [
						{ id: "preset-1", name: "Clash", template },
						{ id: "a", name: "Code", template },
					],
					defaultPresetId: "a",
				},
			},
		});

		expect(again.layouts.getState()).toEqual({
			presets: [
				expect.objectContaining({ id: "preset-1", name: "Mine" }),
				expect.objectContaining({ id: "a", name: "Code" }),
			],
			defaultPresetId: "preset-1",
		});
	});
});
