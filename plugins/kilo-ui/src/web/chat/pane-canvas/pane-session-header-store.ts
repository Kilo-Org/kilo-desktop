import { create } from "zustand";

import type { Arrangement } from "@kilo-desktop/pane-layout";

import type { RightPanelTabDefinition } from "../right-panel/right-panel-tab-registry.js";
import type { LayoutPreset, LayoutTemplate } from "../../../contracts/layout-presets/schemas.js";

type PaneSessionHeaderState = {
	ready: boolean;
	sessionId: string | null;
	hasCanvas: boolean;
	workspaceDirectory: string | null;
	arrangement: Arrangement;
	onArrangementChange: (arrangement: Arrangement) => void;
	definitions: readonly RightPanelTabDefinition[];
	onLaunch: (definition: RightPanelTabDefinition) => void;
	onOpenChanges: () => void;
	onLaunchChat: () => void;
	captureLayout: () => { template: LayoutTemplate; omittedTitles: string[] };
	onApplyLayout: (preset: LayoutPreset) => void;
};

const idle: PaneSessionHeaderState = {
	ready: false,
	sessionId: null,
	hasCanvas: false,
	workspaceDirectory: null,
	arrangement: "tiles",
	onArrangementChange: () => undefined,
	definitions: [],
	onLaunch: () => undefined,
	onOpenChanges: () => undefined,
	onLaunchChat: () => undefined,
	captureLayout: () => {
		throw new Error("No chat layout is available.");
	},
	onApplyLayout: () => undefined,
};

export const usePaneSessionHeaderStore = create<PaneSessionHeaderState>(() => idle);

export function resetPaneSessionHeader() {
	usePaneSessionHeaderStore.setState(idle);
}
