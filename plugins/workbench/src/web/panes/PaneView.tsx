import { PuzzleIcon } from "lucide-react";

import { RenderContribution } from "@kilo-desktop/kernel/web";
import type {
	Pane,
	PaneImplementation,
	PaneProps,
	Session,
} from "@kilo-desktop/plugin-sessions/contracts";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

import { useSessionWorkspace } from "../home/use-active-session";
import { implementationOf, type PaneKinds } from "./use-pane-kinds";

const selectComponent = (implementation: PaneImplementation) => implementation.component;

/** Where a session works: its worktree, else its workspace's primary folder. */
export function useSessionDirectory(session: Session): string | null {
	const workspace = useSessionWorkspace(session);
	return (
		session.directory ??
		workspace?.folders.find((folder) => folder.isPrimary)?.path ??
		workspace?.folders[0]?.path ??
		null
	);
}

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

/** A pane's content from its kind's component, or why it can't be shown. */
export function PaneView({
	session,
	pane,
	kinds,
	directory,
	visible,
}: {
	readonly session: Session;
	readonly pane: Pane;
	readonly kinds: PaneKinds;
	readonly directory: string | null;
	readonly visible: boolean;
}) {
	const kind = kinds.byKey.get(pane.kind);
	if (!kind || !implementationOf(kind)) return <UnavailablePane title={pane.title} />;
	if (!visible && !kind.metadata.keepAlive) return null;
	const props: PaneProps = {
		sessionId: session.id,
		pane,
		workspaceId: session.workspaceId,
		directory,
		visible,
	};
	return (
		<RenderContribution
			key={`${session.id}:${pane.id}`}
			contribution={kind}
			props={props}
			select={selectComponent}
		/>
	);
}
