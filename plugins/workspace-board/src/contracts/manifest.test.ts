import { describe, expect, it } from "vitest";

import { discoverPlugins, KERNEL_CONTEXT_KEYS, KERNEL_DEFINITIONS } from "@kilo-desktop/kernel";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import {
	Board,
	BOARD_COMMANDS,
	BOARD_DEFINITIONS,
	BOARD_FEATURE_FLAG,
	BOARD_MENU_ITEM_IDS,
	BOARD_PLUGIN_ID,
	BOARD_TELEMETRY_EVENTS,
	BOARD_VIEW,
	CLEAR_BOARD_DIALOG,
} from "./index";

describe("kilo.workspace-board manifest", () => {
	const discover = () =>
		discoverPlugins(
			[
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
				{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
				{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
				{ manifest, definitions: BOARD_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

	it("agrees with its contracts and those of the kernel, kilo.shell and kilo.work-sessions", () => {
		expect(discover().issues).toEqual([]);
	});

	const contributions = (point: `${string}/${string}`) =>
		discover().plugins.find((plugin) => plugin.manifest.id === BOARD_PLUGIN_ID)!.manifest
			.contributes!.extensions![point]!;
	const key = (id: string) => `${BOARD_PLUGIN_ID}/${id}`;
	const flagged = { all: [`kernel/flag:${BOARD_FEATURE_FLAG}`] };

	it("keeps origin's ids", () => {
		expect(Board.id).toBe("kilo.workspace-board/board");
		expect(contributions("kernel/command").map((entry) => entry.id)).toEqual(
			Object.values(BOARD_COMMANDS),
		);
		expect(contributions("kilo.work-sessions/work-session-menu").map((entry) => entry.id)).toEqual([
			...BOARD_MENU_ITEM_IDS,
		]);
		expect(contributions("kernel/telemetry-event").map((entry) => entry.id)).toEqual(
			Object.values(BOARD_TELEMETRY_EVENTS),
		);
	});

	it("is a detachable work sessions view with a list button and a clear dialog, behind its flag", () => {
		expect(contributions("kilo.work-sessions/work-sessions-view")).toEqual([
			{ id: "board", title: "Workspace Board", detachable: true, when: flagged },
		]);
		expect(key("board")).toBe(BOARD_VIEW);
		expect(contributions("kilo.work-sessions/work-session-list-action")).toEqual([
			{ id: "board", when: flagged },
		]);
		expect(contributions("kilo.shell/dialog").map((entry) => key(String(entry.id)))).toEqual([
			CLEAR_BOARD_DIALOG,
		]);
		expect(contributions("kernel/flag")).toEqual([
			expect.objectContaining({ id: BOARD_FEATURE_FLAG, default: false }),
		]);
		for (const command of contributions("kernel/command")) {
			expect(command.when).toEqual({ ...flagged, none: ["kernel/secondaryWindow"] });
		}
	});
});
