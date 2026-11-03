import type { Session, SessionMenuItem } from "@kilo-desktop/plugin-sessions/contracts";

import { findSessionPlacement } from "../contracts";
import { boardStore } from "./board-store";
import { BOARD_EVENTS, track } from "./telemetry";

const placementOf = (session: Session) => findSessionPlacement(boardStore().snapshot(), session.id);

const columnChoices = (session: Session) => {
	const placement = placementOf(session);
	return boardStore()
		.snapshot()
		.columns.map((column) => ({
			id: column.id,
			title: column.label,
			checked: column.id === placement?.columnId,
		}));
};

const placeFromMenu = (session: Session, columnId?: string) => {
	const target = columnId ?? boardStore().snapshot().columns[0]?.id;
	if (!target) return;
	boardStore().place(session.id, target);
	track(BOARD_EVENTS.placed, { source: "menu" });
};

/** kilo.sessions/session-menu items: the session's place on the board. */
export const BOARD_MENU_ITEMS: Readonly<Record<string, SessionMenuItem>> = {
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
