import { useCallback, useEffect, useMemo, useState } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { navigateToChat } from "../chat-navigation.js";
import { WORKSPACE_BOARD_ROUTE_PATH } from "./workspace-board-constants.js";
import {
	WORKSPACE_BOARD_DOCKED_EVENT,
	isWorkspaceBoardWindow,
	WORKSPACE_BOARD_WINDOW,
	WORKSPACE_BOARD_WINDOW_DESCRIPTOR,
} from "./workspace-board-window.js";

export type WorkspaceBoardWindow = {
	/** This renderer is a pop-out window, so chats it opens go to the main window. */
	isDetached: boolean;
	/** The main window can move the board into a window of its own. */
	canPopOut: boolean;
	/** Seen from the main window: the board is open in its own window. */
	isPoppedOut: boolean;
	popOut: () => void;
	focus: () => void;
	/** Closes the board's window and shows the board in the main window. */
	dock: () => void;
};

/**
 * The board's pop-out window, from either side. The main window mirrors
 * whether it is open from the shell's pane-window events (it also closes from
 * its own title bar), and the board window hands the main window its work
 * through `kilo-ui` events because each window runs its own router and chat
 * runtime.
 */
export function useWorkspaceBoardWindow(enabled: boolean): WorkspaceBoardWindow {
	const sdk = useSdk("kilo-ui");
	const isDetached = sdk.shell.windowRole === "pane";
	const canPopOut = enabled && !isDetached && sdk.shell.canPopOutPanes;
	const [isPoppedOut, setPoppedOut] = useState(false);

	useEffect(() => {
		if (!canPopOut) return;
		let current = true;
		let changed = false;
		const unsubscribe = sdk.shell.onPaneWindowChanged((event) => {
			if (!isWorkspaceBoardWindow(event)) return;
			if (event.type === "opened") setPoppedOut(true);
			else if (event.type === "docked") setPoppedOut(false);
			else return;
			changed = true;
		});
		sdk.shell.listPaneWindows(WORKSPACE_BOARD_WINDOW.pluginId).then(
			(windows) => {
				// A lifecycle event is newer than a list that was requested before it.
				if (current && !changed) setPoppedOut(windows.some(isWorkspaceBoardWindow));
			},
			() => undefined,
		);
		const unsubscribeDocked = sdk.events.on(`kilo-ui.${WORKSPACE_BOARD_DOCKED_EVENT}`, () => {
			setPoppedOut(false);
			sdk.navigate(WORKSPACE_BOARD_ROUTE_PATH);
		});
		return () => {
			current = false;
			unsubscribe();
			unsubscribeDocked();
		};
	}, [canPopOut, sdk]);

	const popOut = useCallback(() => {
		const width = boardColumnsWidth();
		sdk.shell
			.openPaneWindow({ ...WORKSPACE_BOARD_WINDOW_DESCRIPTOR, ...(width ? { width } : {}) })
			.then(
				() => {
					setPoppedOut(true);
					navigateToChat(sdk);
				},
				(error: unknown) => {
					toast.error("Could not pop out the board", {
						description: error instanceof Error ? error.message : "Please try again.",
					});
				},
			);
	}, [sdk]);

	const focus = useCallback(() => {
		sdk.shell.focusPaneWindow(WORKSPACE_BOARD_WINDOW).then(
			({ focused }) => {
				if (!focused) setPoppedOut(false);
			},
			() => undefined,
		);
	}, [sdk]);

	const dock = useCallback(() => {
		if (isDetached) {
			sdk.events.emit(WORKSPACE_BOARD_DOCKED_EVENT, undefined);
			void sdk.shell.focusMainWindow();
		} else {
			setPoppedOut(false);
			sdk.navigate(WORKSPACE_BOARD_ROUTE_PATH);
		}
		void sdk.shell.dockPaneWindow(WORKSPACE_BOARD_WINDOW);
	}, [isDetached, sdk]);

	return useMemo(
		() => ({ isDetached, canPopOut, isPoppedOut, popOut, focus, dock }),
		[canPopOut, dock, focus, isDetached, isPoppedOut, popOut],
	);
}

/**
 * The full width of the board's columns, read from the board on screen when it
 * is popped out (its title bar is the only place that offers it), so its window
 * opens wide enough not to scroll sideways.
 */
function boardColumnsWidth(): number | undefined {
	return document.querySelector<HTMLElement>("[data-workspace-board-columns]")?.scrollWidth;
}
