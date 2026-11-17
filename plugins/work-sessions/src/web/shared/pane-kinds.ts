import { PuzzleIcon } from "lucide-react";
import { useSyncExternalStore, type ComponentType } from "react";

import type { Contribution, WhenExpression } from "@kilo-desktop/kernel";
import { useExtensions, useSdk } from "@kilo-desktop/kernel/web";
import type { PaneKind as LayoutKind } from "@kilo-desktop/pane-layout";

import { PaneKind, type PaneImplementation } from "../../contracts";

/** A pane kind as the canvas, the "+" menus and the New Session page offer it. */
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
	/** Also has its own button in the session header, after its "+" menu (`launch.sessionHeader`). */
	readonly pinned?: boolean;
	/** False keeps it out of tab groups' "+" menus (`launch.tabGroup`); offered there by default. */
	readonly inTabGroups?: boolean;
	/** The command that opens this kind; its shortcut is shown on the New Session page. */
	readonly openCommand?: string | undefined;
}

export type PaneKindContribution = Contribution<typeof PaneKind>;

export interface PaneKinds {
	/** Every contributed kind, by its key, implemented in this window or not. */
	readonly byKey: ReadonlyMap<string, PaneKindContribution>;
	/** Kinds offered by the "+" menus in a work session. */
	readonly inSession: readonly CanvasPaneKind[];
	/** Kinds offered by the New Session page. */
	readonly newSession: readonly CanvasPaneKind[];
	readonly layoutKindOf: (kind: string) => LayoutKind;
}

export const implementationOf = (kind: PaneKindContribution | undefined) =>
	kind?.implementation as PaneImplementation | undefined;

/** Kinds in their listing `order`; the sort is stable, so ties keep plugin order. */
const byListingOrder = (contributions: readonly PaneKindContribution[]) =>
	contributions.toSorted((a, b) => a.metadata.order - b.metadata.order);

/**
 * The contributed kinds in listing order, with which kinds' `availableWhen`
 * holds as a string of 0s and 1s (by index) that changes with context keys.
 */
function useOrderedPaneKinds(): {
	readonly contributions: readonly PaneKindContribution[];
	readonly availability: string;
} {
	const sdk = useSdk();
	const contributions = byListingOrder(useExtensions(PaneKind));
	const read = () =>
		contributions
			.map((kind) =>
				sdk.context.evaluate(kind.metadata.availableWhen as WhenExpression | undefined) ? "1" : "0",
			)
			.join("");
	const availability = useSyncExternalStore(sdk.context.subscribe, read, read);
	return { contributions, availability };
}

/** The pane kinds plugins contribute (`kilo.work-sessions/pane-kind`), shaped for the canvas and the New Session page. */
export function usePaneKinds(): PaneKinds {
	const { contributions, availability } = useOrderedPaneKinds();

	const byKey = new Map<string, PaneKindContribution>(
		contributions.map((kind) => [kind.key, kind]),
	);
	const toCanvas = (kind: PaneKindContribution, index: number): CanvasPaneKind => {
		const implementation = implementationOf(kind);
		const available = availability[index] === "1";
		return {
			id: kind.key,
			title: kind.metadata.title,
			description: kind.metadata.description,
			Icon: implementation?.icon ?? PuzzleIcon,
			addable: implementation !== undefined,
			unavailableHint: available
				? undefined
				: (kind.metadata.unavailableHint ?? `${kind.metadata.title} isn't available right now.`),
			keepAlive: kind.metadata.keepAlive,
			pinned: kind.metadata.launch.sessionHeader,
			inTabGroups: kind.metadata.launch.tabGroup,
			openCommand: kind.metadata.openCommand,
		};
	};
	const shaped = contributions.map(toCanvas);
	return {
		byKey,
		inSession: shaped.filter((_, index) => contributions[index]!.metadata.launch.inSession),
		newSession: shaped.filter(
			(kind, index) => kind.addable && contributions[index]!.metadata.launch.newSession,
		),
		layoutKindOf: (kind) => byKey.get(kind)?.metadata.layoutKind ?? "tool",
	};
}
