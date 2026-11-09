/**
 * How commands reach the New Session page when no session is open (a pane's
 * open command, New empty session): the mounted page registers its start
 * action here (it owns the workspace, isolation and in-flight state), and
 * the commands call it. One page per window renderer, so a single slot;
 * unmounting clears it only if it still holds that page's action.
 */
type StartFromPage = (kind: string | undefined) => void;

let registered: StartFromPage | null = null;

export function registerLauncherStart(start: StartFromPage): () => void {
	registered = start;
	return () => {
		if (registered === start) registered = null;
	};
}

/** Starts a session from the New Session page, with `kind` or empty; false when it isn't showing. */
export function startFromLauncher(kind?: string): boolean {
	if (!registered) return false;
	registered(kind);
	return true;
}
