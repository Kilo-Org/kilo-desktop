import { useEffect, useState, useSyncExternalStore } from "react";

/*
 * Window-local requests for the New Session page's starter to take focus.
 * `WorkSessionsWindow.closeWorkSession` (New session, ⌘N, a workspace's "+") requests it;
 * the New Session page hands the request to the starter as `focusRequest`. Each
 * request is handed over once: a page mounted again for another reason
 * (the open session was deleted, back from Settings) gets 0, so it doesn't
 * take focus from wherever the person is.
 */

let requested = 0;
let handed = 0;
const listeners = new Set<() => void>();

export function requestLauncherFocus(): void {
	requested += 1;
	for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
	listeners.add(onChange);
	return () => listeners.delete(onChange);
}

const getRequested = () => requested;

/** The request to hand the starter: a new number per request, or 0. */
export function useLauncherFocusRequest(): number {
	const current = useSyncExternalStore(subscribe, getRequested, getRequested);
	const [alreadyHanded] = useState(() => (handed === current ? current : null));
	useEffect(() => {
		handed = current;
	}, [current]);
	return current === alreadyHanded ? 0 : current;
}
