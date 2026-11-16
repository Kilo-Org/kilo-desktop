import { PuzzleIcon } from "lucide-react";
import { memo } from "react";

import { RenderContribution } from "@kilo-desktop/kernel/web";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

import type { Pane, PaneImplementation, PaneProps, WorkSession } from "../../contracts";
import { implementationOf, type PaneKinds } from "../shared/pane-kinds";

const selectComponent = (implementation: PaneImplementation) => implementation.component;

function UnavailablePane({ title }: { readonly title: string }) {
	return (
		<Empty data-qa-id="pane-unavailable">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<PuzzleIcon />
				</EmptyMedia>
				<EmptyTitle>{title} isn't available</EmptyTitle>
				<EmptyDescription>
					The plugin that provides this pane isn't installed, or didn't load.
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

/**
 * A pane's content from its kind's component, or why it can't be shown.
 * Memoized: the canvas re-renders on every layout change (each frame of a
 * splitter drag), and a pane's content (a transcript, a terminal) needn't.
 */
export const PaneView = memo(function PaneView({
	workSession,
	pane,
	kinds,
	directory,
	visible,
}: {
	readonly workSession: WorkSession;
	readonly pane: Pane;
	readonly kinds: PaneKinds;
	readonly directory: string | null;
	readonly visible: boolean;
}) {
	const kind = kinds.byKey.get(pane.kind);
	if (!kind || !implementationOf(kind)) return <UnavailablePane title={pane.title} />;
	if (!visible && !kind.metadata.keepAlive) return null;
	const props: PaneProps = {
		workSessionId: workSession.id,
		pane,
		workspaceId: workSession.workspaceId,
		directory,
		visible,
	};
	return (
		<RenderContribution
			key={`${workSession.id}:${pane.id}`}
			contribution={kind}
			props={props}
			select={selectComponent}
		/>
	);
});
