import { create } from "zustand";

import type { Arrangement } from "@kilo-desktop/pane-layout";

import type { RightPanelTabDefinition } from "../right-panel/right-panel-tab-registry.js";

type PaneSessionHeaderState = {
	ready: boolean;
	sessionId: string | null;
	hasCanvas: boolean;
	arrangement: Arrangement;
	onArrangementChange: (arrangement: Arrangement) => void;
	definitions: readonly RightPanelTabDefinition[];
	onLaunch: (definition: RightPanelTabDefinition) => void;
	onLaunchChat: () => void;
};

const idle: PaneSessionHeaderState = {
	ready: false,
	sessionId: null,
	hasCanvas: false,
	arrangement: "tiles",
	onArrangementChange: () => undefined,
	definitions: [],
	onLaunch: () => undefined,
	onLaunchChat: () => undefined,
};

export const usePaneSessionHeaderStore = create<PaneSessionHeaderState>(() => idle);

export function resetPaneSessionHeader() {
	usePaneSessionHeaderStore.setState(idle);
}
