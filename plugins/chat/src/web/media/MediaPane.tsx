import { AppWindowIcon, ImageIcon, WorkflowIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FC } from "react";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Panes, type PaneProps } from "@kilo-desktop/plugin-work-sessions/contracts";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { MediaViewer } from "@kilo-desktop/ui/components/media-lightbox";

import {
	MEDIA_ITEM_METADATA_KEY,
	mediaItemTitle,
	MediaViewers,
	mediaViewerKey,
	type MediaItem,
} from "../../contracts";
import { renderChatLightboxActions } from "../thread/lightbox/chat-lightbox";
import { toLightboxItem } from "./lightbox-items";
import { takeViewerItems } from "./viewer-handoff";

export const MediaIcon: FC<{ className?: string; iconKey?: string }> = ({ className, iconKey }) =>
	iconKey === "image" ? (
		<ImageIcon className={className} />
	) : iconKey === "page" ? (
		<AppWindowIcon className={className} />
	) : (
		<WorkflowIcon className={className} />
	);

/**
 * The viewer's items whenever its revision changes (a transcript showed new
 * ones): handed over by this window's transcript when it showed them, else
 * fetched from main. While a fetch is in flight `items` are the previous
 * revision's, if any; null once they're gone.
 */
function useViewerItems(
	workSessionId: string,
	paneId: string,
): { items: readonly MediaItem[] | null; loading: boolean } {
	const key = mediaViewerKey(workSessionId, paneId);
	const viewers = useDomainObject(MediaViewers);
	const revision = useDomainObjectState(
		MediaViewers,
		useCallback(
			(state: DomainObjectState<typeof MediaViewers>) => state.viewers[key]?.revision,
			[key],
		),
	);
	const [fetched, setFetched] = useState<{
		key: string;
		revision: number;
		items: readonly MediaItem[] | null;
	} | null>(null);

	useEffect(() => {
		if (revision === undefined) return;
		const handed = takeViewerItems(key, revision);
		if (handed) {
			setFetched({ key, revision, items: handed });
			return;
		}
		if (!viewers) return;
		let current = true;
		viewers.methods
			.items({ workSessionId, paneId })
			.then(
				(items) => items,
				() => null,
			)
			.then((items) => {
				if (current) setFetched({ key, revision, items });
			});
		return () => {
			current = false;
		};
	}, [key, paneId, revision, workSessionId, viewers]);

	if (revision === undefined) return { items: null, loading: false };
	const own = fetched?.key === key ? fetched : null;
	return { items: own?.items ?? null, loading: own?.revision !== revision };
}

/**
 * The media viewer pane: the items its chat's transcript opened it with (kept
 * in main by `media-viewers`), on the one its metadata names. Moving between
 * items records the new one in the pane, retitling its tab.
 */
export function MediaPane({ workSessionId, pane }: PaneProps) {
	const { items, loading } = useViewerItems(workSessionId, pane.id);
	const viewed = useMemo(() => items?.map(toLightboxItem) ?? [], [items]);
	const panes = useDomainObject(Panes);
	const itemId = pane.metadata[MEDIA_ITEM_METADATA_KEY];

	// Until the items for the item opened arrive, show nothing rather than a stale one.
	if (loading && !items?.some((item) => item.id === itemId)) {
		return (
			<div
				className="bg-pane flex h-full min-h-0 flex-col"
				data-qa-id="chat-media-pane"
				aria-busy="true"
			/>
		);
	}

	if (!items?.length) {
		return (
			<div className="bg-pane flex h-full min-h-0 flex-col" data-qa-id="chat-media-pane">
				<Empty data-qa-id="chat-media-pane-empty">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<ImageIcon aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>Nothing to show</EmptyTitle>
						<EmptyDescription>
							Open a diagram, image or page from the chat to view it here.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</div>
		);
	}

	const index = Math.max(
		0,
		items.findIndex((item) => item.id === itemId),
	);
	return (
		<div className="bg-pane flex h-full min-h-0 flex-col" data-qa-id="chat-media-pane">
			<MediaViewer
				className="flex-1"
				items={viewed}
				index={index}
				onIndexChange={(next) => {
					const item = items[next];
					if (!item || !panes) return;
					void panes.methods
						.update({
							workSessionId,
							paneId: pane.id,
							title: mediaItemTitle(item),
							iconKey: item.kind,
							metadata: { ...pane.metadata, [MEDIA_ITEM_METADATA_KEY]: item.id },
						})
						.catch(() => undefined);
				}}
				renderActions={renderChatLightboxActions}
			/>
		</div>
	);
}
