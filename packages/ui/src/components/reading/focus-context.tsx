import { createContext, use, useEffect } from "react";

/**
 * What the Focus reader shares with what renders inside it: where popups
 * portal (a layer above the reader but outside its themed root, so they keep
 * the app's theme and text size) and a count of open layers (popovers, menus)
 * so Escape closes the layer before Focus.
 */
export interface FocusReaderContextValue {
	readonly portalContainer: HTMLElement | null;
	readonly openLayer: () => () => void;
}

export const FocusReaderContext = createContext<FocusReaderContextValue | null>(null);

/** The Focus reader's popup layer while inside one; popups there portal into it. */
export function useFocusPortalContainer(): HTMLElement | null {
	return use(FocusReaderContext)?.portalContainer ?? null;
}

/** Inside a Focus reader, holds Escape for this layer while `open`. */
export function useFocusLayer(open: boolean): void {
	const context = use(FocusReaderContext);
	useEffect(() => {
		if (!open || !context) return;
		return context.openLayer();
	}, [context, open]);
}
