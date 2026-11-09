import { vi } from "vitest";

import type { PluginSdk } from "@kilo-desktop/kernel";
import type { MainKernelHost } from "@kilo-desktop/kernel/main";
import { testManifest } from "@kilo-desktop/kernel/testing";
import type { ChatSummary } from "@kilo-desktop/plugin-agent/contracts";
import {
	SessionDecoration,
	type Session,
	type SessionDecorationProps,
} from "@kilo-desktop/plugin-sessions/contracts";
import telemetryManifest from "@kilo-desktop/plugin-telemetry/plugin.json";
import { Telemetry, TELEMETRY_DEFINITIONS } from "@kilo-desktop/plugin-telemetry/contracts";
import { renderWorkbench } from "@kilo-desktop/plugin-workbench/testing";
import type { Workspace } from "@kilo-desktop/plugin-workspaces/contracts";

import manifest from "../../plugin.json";
import { Board, BOARD_DEFINITIONS } from "../contracts";
import { createBoardMainEntry } from "../main/entry";
import { boardWebEntry } from "../web/index";

/** A stand-in for kilo.flags with the workspace board on or off. */
const flagsPlugin = (on: boolean) => ({
	manifest: testManifest("kilo.flags", { contextKeys: [{ id: "flag:*", scope: "global" }] }),
	main: {
		activate(sdk: PluginSdk) {
			sdk.context.set("flag:workspace-board", on);
		},
	},
});

/** kilo.telemetry's domain, recording what the board sends. */
function telemetryPlugin() {
	const tracked = vi.fn<(event: string, data: Record<string, unknown>) => void>();
	return {
		tracked,
		plugin: {
			manifest: telemetryManifest,
			definitions: TELEMETRY_DEFINITIONS,
			main: {
				activate(sdk: PluginSdk) {
					sdk.domains.provide(Telemetry, {
						initialState: {},
						methods: { track: ({ event, data }) => void tracked(event, data) },
					});
				},
			},
		},
	};
}

/** A row decoration, as git's pull request badge is. */
const decorationsPlugin = {
	manifest: testManifest("test.decorations", {
		contributes: {
			extensions: { "kilo.sessions/session-decoration": [{ id: "badge", slot: "row" }] },
		},
	}),
	web: {
		activate(sdk: PluginSdk) {
			sdk.extensions.implement(
				SessionDecoration,
				"badge",
				({ session, interactive }: SessionDecorationProps) => (
					<span data-qa-id={`badge-${session.id}`} data-interactive={interactive}>
						#12
					</span>
				),
			);
		},
	},
};

/**
 * kilo.workspace-board on the real shell and workbench (kilo.workbench's test host),
 * with kilo.sessions, kilo.workspaces and kilo.agent's chats standing in,
 * a row decoration, kilo.flags and kilo.telemetry.
 */
export async function renderBoard(
	options: {
		sessions?: Session[];
		workspaces?: Workspace[];
		chats?: ChatSummary[];
		flag?: boolean;
		focus?: string | null;
		windows?: MainKernelHost["windows"];
		/** Adds a row decoration (as git's PR badge). */
		decorations?: boolean;
	} = {},
) {
	const telemetry = telemetryPlugin();
	const workbench = await renderWorkbench({
		sessions: options.sessions ?? [],
		workspaces: options.workspaces ?? [],
		...(options.chats ? { chats: options.chats } : {}),
		...(options.windows ? { windows: options.windows } : {}),
		...(options.focus !== undefined
			? {
					localStorage: {
						"kilo.workbench.navigator:main": JSON.stringify({ focus: options.focus }),
					},
				}
			: {}),
		guests: [
			flagsPlugin(options.flag ?? true),
			telemetry.plugin,
			...(options.decorations ? [decorationsPlugin] : []),
			{
				manifest,
				definitions: BOARD_DEFINITIONS,
				main: createBoardMainEntry(),
				web: boardWebEntry,
			},
		],
	});
	const board = () => workbench.host.main.kernelSdk.domains.get(Board)!;
	const cards = () =>
		Object.fromEntries(
			board()
				.getState()
				.board.columns.map((column) => [column.id, column.sessionIds]),
		);
	const runBoard = (command: string) =>
		workbench.host.renderer.commands.execute(`kilo.workspace-board/${command}`);
	return { ...workbench, board, cards, runBoard, tracked: telemetry.tracked };
}
