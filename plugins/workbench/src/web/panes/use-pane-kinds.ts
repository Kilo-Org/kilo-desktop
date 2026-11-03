import { PuzzleIcon } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";

import type { Contribution, WhenExpression } from "@kilo-desktop/kernel";
import { useExtensions, useSdk } from "@kilo-desktop/kernel/web";
import type { PaneKind as LayoutKind } from "@kilo-desktop/pane-layout";
import { PaneKind, type PaneImplementation } from "@kilo-desktop/plugin-sessions/contracts";

import type { CanvasPaneKind } from "../canvas/types";

export type PaneKindContribution = Contribution<typeof PaneKind>;

export interface PaneKinds {
	/** Every contributed kind, by its key, implemented in this window or not. */
	readonly byKey: ReadonlyMap<string, PaneKindContribution>;
	/** Kinds offered by the "+" menus in a session. */
	readonly inSession: readonly CanvasPaneKind[];
	/** Kinds offered by the launcher of a new session. */
	readonly newSession: readonly CanvasPaneKind[];
	readonly layoutKindOf: (kind: string) => LayoutKind;
}

export const implementationOf = (kind: PaneKindContribution | undefined) =>
	kind?.implementation as PaneImplementation | undefined;

/** Which kinds' `availableWhen` holds, as a string of 0s and 1s that changes with context keys. */
function useAvailability(contributions: readonly PaneKindContribution[]): string {
	const sdk = useSdk();
	const read = () =>
		contributions
			.map((kind) =>
				sdk.context.evaluate(kind.metadata.availableWhen as WhenExpression | undefined) ? "1" : "0",
			)
			.join("");
	return useSyncExternalStore(sdk.context.subscribe, read, read);
}

/** Kinds in their listing `order`; the sort is stable, so ties keep plugin order. */
function useOrdered(contributions: readonly PaneKindContribution[]) {
	return useMemo(
		() => [...contributions].sort((a, b) => a.metadata.order - b.metadata.order),
		[contributions],
	);
}

/** The pane kinds plugins contribute (kilo.sessions/pane), shaped for the canvas and launcher. */
export function usePaneKinds(): PaneKinds {
	const contributions = useOrdered(useExtensions(PaneKind));
	const availability = useAvailability(contributions);

	return useMemo(() => {
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
	}, [availability, contributions]);
}
