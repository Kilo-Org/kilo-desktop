import type { ComponentType } from "react";

export interface CanvasPaneKind {
	/** Pane kind key, e.g. "kilo.terminal/terminal". */
	readonly id: string;
	readonly title: string;
	readonly description?: string | undefined;
	readonly Icon: ComponentType<{ className?: string; iconKey?: string }>;
	/** Offered in "+" menus and the new-pane picker. */
	readonly addable: boolean;
	/** When set, the kind is listed but disabled with this hint (e.g. "Sign in to use notebooks"). */
	readonly unavailableHint?: string | undefined;
	/** Keep mounted while hidden. */
	readonly keepAlive: boolean;
	/** Has its own button in the session header instead of a place in the header's "+" menu (`launch.sessionHeader`). */
	readonly pinned?: boolean;
	/** False keeps it out of tab groups' "+" menus (`launch.tabGroup`); offered there by default. */
	readonly inTabGroups?: boolean;
	/** The command that opens this kind; its shortcut is shown on the New Session page. */
	readonly openCommand?: string | undefined;
}
