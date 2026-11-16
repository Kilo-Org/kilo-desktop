import type {
	WorkSession,
	WorkSessionMenuItem,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { BOARD_TELEMETRY_EVENTS, findSessionPlacement } from "../contracts";
import { boardStore } from "./board-store";
import { track } from "./telemetry";

const placementOf = (session: WorkSession) =>
	findSessionPlacement(boardStore().snapshot(), session.id);

const columnChoices = (session: WorkSession) => {
	const placement = placementOf(session);
	return boardStore()
		.snapshot()
		.columns.map((column) => ({
			id: column.id,
			title: column.label,
			checked: column.id === placement?.columnId,
		}));
};

const placeFromMenu = (session: WorkSession, columnId?: string) => {
	const target = columnId ?? boardStore().snapshot().columns[0]?.id;
	if (!target) return;
	boardStore().place(session.id, target);
	track(BOARD_TELEMETRY_EVENTS.placed, { source: "menu" });
};

/** kilo.work-sessions/work-session-menu items: the session's place on the board. */
export const BOARD_MENU_ITEMS: Readonly<Record<string, WorkSessionMenuItem>> = {
	"add-to-board": {
		appliesTo: (session) => boardStore().available() && !placementOf(session),
		choices: columnChoices,
		run: placeFromMenu,
	},
	"move-on-board": {
		appliesTo: (session) => boardStore().available() && Boolean(placementOf(session)),
		choices: columnChoices,
		run: placeFromMenu,
	},
	"remove-from-board": {
		appliesTo: (session) => boardStore().available() && Boolean(placementOf(session)),
		run: (session) => boardStore().remove(session.id),
	},
};
