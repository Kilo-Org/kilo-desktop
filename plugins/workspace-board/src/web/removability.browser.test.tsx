import { describe, expect, it, vi } from "vitest";

import type { KernelLogger } from "@kilo-desktop/kernel";
import {
	createMemoryStorage,
	createTestHost,
	createTestKernelPair,
} from "@kilo-desktop/kernel/testing";
import { WorkSessionMenu, type WorkSession } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import { Board, BOARD_DEFINITIONS, BOARD_FEATURE_FLAG, BOARD_PLUGIN_ID } from "../contracts";
import { createBoardMainEntry } from "../main/entry";
import { boardWebEntry } from "./index";
import { BOARD_MENU_ITEMS } from "./session-menu";

/** The kernel's notes about contributions to points of plugins that aren't there. */
const ABSENT_PLUGINS = /kilo\.(work-sessions|shell)\//;

describe("kilo.workspace-board without kilo.work-sessions, kilo.shell or telemetry consent", () => {
	it("activates and runs its commands, logging no errors", async () => {
		const warnings: unknown[][] = [];
		const errors: unknown[][] = [];
		const logger: KernelLogger = {
			debug: () => {},
			info: () => {},
			warn: (...args) => void warnings.push(args),
			error: (...args) => void errors.push(args),
		};
		const { main, renderer } = await createTestKernelPair({
			host: createTestHost({ flagOverrides: { [BOARD_FEATURE_FLAG]: true } }),
			main: [{ manifest, definitions: BOARD_DEFINITIONS, entry: createBoardMainEntry() }],
			renderer: [{ manifest, definitions: BOARD_DEFINITIONS, entry: boardWebEntry }],
			mainHostServices: () => ({ storage: createMemoryStorage(`/data/${BOARD_PLUGIN_ID}`) }),
			logger,
		});
		await main.flush();
		const run = (command: string) => renderer.commands.execute(`${BOARD_PLUGIN_ID}/${command}`);

		await run("open");
		await run("clear");
		await main.kernelSdk.domainObjects
			.get(Board)!
			.methods.place({ sessionId: "a", columnId: "backlog", index: 0 });
		await run("clear");
		await run("add-column");
		await vi.waitFor(() =>
			expect(main.kernelSdk.domainObjects.get(Board)!.getState().board.columns).toHaveLength(5),
		);
		expect(renderer.extensions.list(WorkSessionMenu)).toEqual([]);

		expect(errors).toEqual([]);
		for (const warning of warnings) expect(String(warning[0])).toMatch(ABSENT_PLUGINS);
		await main.stop();
	});

	it("leaves its menu items out while kilo.workspace-board's main is absent", async () => {
		const { renderer, main } = await createTestKernelPair({
			host: createTestHost({ flagOverrides: { [BOARD_FEATURE_FLAG]: true } }),
			main: [{ manifest, definitions: BOARD_DEFINITIONS }],
			renderer: [{ manifest, definitions: BOARD_DEFINITIONS, entry: boardWebEntry }],
		});
		const session = { id: "a" } as WorkSession;
		for (const item of Object.values(BOARD_MENU_ITEMS)) {
			expect(item.appliesTo?.(session)).toBe(false);
		}
		await renderer.commands.execute(`${BOARD_PLUGIN_ID}/clear`);
		await main.stop();
	});
});
