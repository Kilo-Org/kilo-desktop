import type { PluginSdk } from "@kilo-desktop/kernel";
import type { MainKernelHost } from "@kilo-desktop/kernel/main";
import { testManifest } from "@kilo-desktop/kernel/testing";
import type { ChatSummary } from "@kilo-desktop/plugin-core/contracts";
import {
	WorkSessionDecoration,
	type WorkSession,
	type WorkSessionDecorationProps,
	type Workspace,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import {
	grantDataCollection,
	renderWorkSessions,
	telemetrySink,
} from "@kilo-desktop/plugin-work-sessions/testing";

import manifest from "../../plugin.json";
import { Board, BOARD_DEFINITIONS, BOARD_FEATURE_FLAG, BOARD_PLUGIN_ID } from "../contracts";
import { createBoardMainEntry } from "../main/entry";
import { boardWebEntry } from "../web/index";

/** A row decoration, as git's pull request badge is. */
const decorationsPlugin = {
	manifest: testManifest("test.decorations", {
		contributes: {
			extensions: { "kilo.work-sessions/work-session-decoration": [{ id: "badge", slot: "row" }] },
		},
	}),
	web: {
		activate(sdk: PluginSdk) {
			sdk.extensions.implement(
				WorkSessionDecoration,
				"badge",
				({ workSession, interactive }: WorkSessionDecorationProps) => (
					<span data-qa-id={`badge-${workSession.id}`} data-interactive={interactive}>
						#12
					</span>
				),
			);
		},
	},
};

/**
 * kilo.workspace-board (its real main and web entries) on the real shell and
 * kilo.work-sessions web entry (kilo.work-sessions' test host), with
 * kilo.work-sessions' main and kilo.core's chats standing in, an optional row
 * decoration, the `workspace-board` flag set through the host's flag
 * overrides, and a telemetry sink with consent granted.
 */
export async function renderBoard(
	options: {
		sessions?: WorkSession[];
		workspaces?: Workspace[];
		chats?: ChatSummary[];
		flag?: boolean;
		focus?: string | null;
		windows?: MainKernelHost["windows"];
		/** Adds a row decoration (as git's PR badge). */
		decorations?: boolean;
	} = {},
) {
	const sink = telemetrySink();
	const host = await renderWorkSessions({
		workSessions: options.sessions ?? [],
		workspaces: options.workspaces ?? [],
		...(options.chats ? { chats: options.chats } : {}),
		...(options.windows ? { windows: options.windows } : {}),
		...(options.focus !== undefined
			? {
					localStorage: {
						"kilo.work-sessions.window:main": JSON.stringify({ focus: options.focus }),
					},
				}
			: {}),
		flags: { [BOARD_FEATURE_FLAG]: options.flag ?? true },
		beforeRender: grantDataCollection,
		guests: [
			sink.plugin,
			...(options.decorations ? [decorationsPlugin] : []),
			{
				manifest,
				definitions: BOARD_DEFINITIONS,
				main: createBoardMainEntry(),
				web: boardWebEntry,
			},
		],
	});
	const board = () => host.host.main.kernelSdk.domainObjects.get(Board)!;
	const cards = () =>
		Object.fromEntries(
			board()
				.getState()
				.board.columns.map((column) => [column.id, column.sessionIds]),
		);
	const runBoard = (command: string) =>
		host.host.renderer.commands.execute(`${BOARD_PLUGIN_ID}/${command}`);
	/** The data of every board event sent with this id (`board-opened`…). */
	const tracked = (event: string) =>
		sink.delivered
			.filter(({ key }) => key === `${BOARD_PLUGIN_ID}/${event}`)
			.map(({ data }) => data);
	return { ...host, board, cards, runBoard, tracked };
}
