import { createContext, use, useSyncExternalStore } from "react";

export interface OpenDialog {
	/** The `kilo.shell/dialog` contribution key. */
	readonly key: string;
	readonly input: unknown;
}

export interface RightSidebarState {
	readonly open: boolean;
	/** The chosen panel's contribution key; the first panel when unset or gone. */
	readonly selected: string | undefined;
}

/**
 * Window-local UI state that commands and navigation requests drive from
 * outside React: the palette, the shortcuts dialog, open dialogs, the right
 * sidebar and the left sidebar's toggle. Created once per activation and
 * handed to the frame; nothing here outlives the window.
 */
export interface ShellUiState {
	isPaletteOpen(): boolean;
	setPaletteOpen(open: boolean): void;
	isShortcutsOpen(): boolean;
	setShortcutsOpen(open: boolean): void;
	openDialogs(): readonly OpenDialog[];
	/** Opens a dialog, or gives an open one the new input. */
	openDialog(key: string, input: unknown): void;
	closeDialog(key: string): void;
	rightSidebar(): RightSidebarState;
	setRightSidebar(patch: Partial<RightSidebarState>): void;
	/** The frame registers how to toggle the sidebar while it is mounted. */
	registerSidebarToggle(toggle: () => void): () => void;
	toggleSidebar(): void;
	subscribe(listener: () => void): () => void;
}

export function createShellUiState(): ShellUiState {
	let paletteOpen = false;
	let shortcutsOpen = false;
	let dialogs: readonly OpenDialog[] = [];
	let rightSidebar: RightSidebarState = { open: true, selected: undefined };
	let sidebarToggle: (() => void) | undefined;
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of [...listeners]) listener();
	};
	return {
		isPaletteOpen: () => paletteOpen,
		setPaletteOpen(open) {
			if (paletteOpen === open) return;
			paletteOpen = open;
			notify();
		},
		isShortcutsOpen: () => shortcutsOpen,
		setShortcutsOpen(open) {
			if (shortcutsOpen === open) return;
			shortcutsOpen = open;
			notify();
		},
		openDialogs: () => dialogs,
		openDialog(key, input) {
			dialogs = [...dialogs.filter((dialog) => dialog.key !== key), { key, input }];
			notify();
		},
		closeDialog(key) {
			if (!dialogs.some((dialog) => dialog.key === key)) return;
			dialogs = dialogs.filter((dialog) => dialog.key !== key);
			notify();
		},
		rightSidebar: () => rightSidebar,
		setRightSidebar(patch) {
			rightSidebar = { ...rightSidebar, ...patch };
			notify();
		},
		registerSidebarToggle(toggle) {
			sidebarToggle = toggle;
			return () => {
				if (sidebarToggle === toggle) sidebarToggle = undefined;
			};
		},
		toggleSidebar: () => sidebarToggle?.(),
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

const ShellUiContext = createContext<ShellUiState | null>(null);
export const ShellUiProvider = ShellUiContext.Provider;

export function useShellUi(): ShellUiState {
	const state = use(ShellUiContext);
	if (!state) throw new Error("useShellUi must be used inside the shell frame.");
	return state;
}

function useShellUiValue<T>(read: (state: ShellUiState) => T): T {
	const state = useShellUi();
	const snapshot = () => read(state);
	return useSyncExternalStore(state.subscribe, snapshot, snapshot);
}

export function usePaletteOpen(): [boolean, (open: boolean) => void] {
	const state = useShellUi();
	return [useShellUiValue((ui) => ui.isPaletteOpen()), state.setPaletteOpen];
}

export function useShortcutsOpen(): [boolean, (open: boolean) => void] {
	const state = useShellUi();
	return [useShellUiValue((ui) => ui.isShortcutsOpen()), state.setShortcutsOpen];
}

export function useOpenDialogs(): readonly OpenDialog[] {
	return useShellUiValue((ui) => ui.openDialogs());
}

export function useRightSidebar(): RightSidebarState {
	return useShellUiValue((ui) => ui.rightSidebar());
}
