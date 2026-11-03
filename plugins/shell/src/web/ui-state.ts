import { createContext, use, useSyncExternalStore } from "react";

/**
 * Window-local UI state that commands drive from outside React (the palette
 * and the sidebar). Created once per activation and handed to the frame.
 */
export interface ShellUiState {
	isPaletteOpen(): boolean;
	setPaletteOpen(open: boolean): void;
	isShortcutsOpen(): boolean;
	setShortcutsOpen(open: boolean): void;
	/** The frame registers how to toggle the sidebar while it is mounted. */
	registerSidebarToggle(toggle: () => void): () => void;
	toggleSidebar(): void;
	subscribe(listener: () => void): () => void;
}

export function createShellUiState(): ShellUiState {
	let paletteOpen = false;
	let shortcutsOpen = false;
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

export function usePaletteOpen(): [boolean, (open: boolean) => void] {
	const state = useShellUi();
	const open = useSyncExternalStore(state.subscribe, state.isPaletteOpen, state.isPaletteOpen);
	return [open, state.setPaletteOpen];
}

export function useShortcutsOpen(): [boolean, (open: boolean) => void] {
	const state = useShellUi();
	const open = useSyncExternalStore(state.subscribe, state.isShortcutsOpen, state.isShortcutsOpen);
	return [open, state.setShortcutsOpen];
}
