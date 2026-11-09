import { memo, useMemo } from "react";
import type { ToolCallMessagePartComponent, ToolCallMessagePartProps } from "@assistant-ui/react";
import { DownloadIcon, Maximize2Icon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";

import { HTML_RENDER_MAX_HEIGHT, readHtmlRenderArgs, type HtmlRenderInput } from "../../contracts";
import { useLightboxItem, type LightboxItemInput } from "../thread/lightbox/chat-lightbox";
import { showsHoistedPage } from "../tools/activity-grouping";
import { ToolStatusIcon, resultText, truncate } from "../tools/tool-ui-shared";
import { useIsInTurnWorkFold } from "../tools/turn-work-fold-context";
import { HtmlRenderFrame } from "./HtmlRenderFrame";
import { useSaveHtmlPage } from "./use-save-html-page";

/**
 * The page in place, with Save and Open in viewer. The viewer is the chat's
 * Viewer pane (its gallery spans the transcript's pages, diagrams and images),
 * or a full-window dialog where there's no pane to open.
 */
function HtmlRenderView({
	html,
	title,
	height,
	cacheKey,
}: HtmlRenderInput & { readonly cacheKey: string }) {
	const saveToWorkspace = useSaveHtmlPage();
	const lightboxInput = useMemo<LightboxItemInput>(
		() => ({ kind: "page", title, html }),
		[title, html],
	);
	const viewer = useLightboxItem(lightboxInput);
	return (
		<div ref={viewer.ref} className="group/html-render my-3" data-qa-id="kilo-html-render">
			<HtmlRenderFrame
				html={html}
				title={title}
				fit="content"
				maxHeight={height ?? HTML_RENDER_MAX_HEIGHT}
				heightCacheKey={cacheKey}
			/>
			<div className="flex h-7 items-center justify-end gap-1 opacity-0 transition-opacity group-hover/html-render:opacity-100 focus-within:opacity-100">
				<span className="text-muted-foreground truncate text-xs">{title}</span>
				{saveToWorkspace ? (
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={`Save ${title} to workspace`}
						disabled={saveToWorkspace.saving}
						onClick={() => void saveToWorkspace.save({ title, html })}
					>
						<DownloadIcon />
					</Button>
				) : null}
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={`Open ${title} in viewer`}
					data-qa-id="kilo-html-render-open"
					onClick={viewer.open}
				>
					<Maximize2Icon />
				</Button>
			</div>
			{viewer.lightbox}
		</div>
	);
}

type HtmlRenderPartProps = Pick<
	ToolCallMessagePartProps,
	"toolCallId" | "args" | "status" | "result"
>;

/** The agent's page for one `html_render` call, or its loading/error state. */
export const HtmlRenderPart = memo(({ toolCallId, args, status, result }: HtmlRenderPartProps) => {
	const page = readHtmlRenderArgs(args);
	if (status.type === "complete" && page) {
		return <HtmlRenderView key={toolCallId} cacheKey={toolCallId} {...page} />;
	}
	if (status.type === "running" || status.type === "requires-action") {
		return <Skeleton className="my-3 h-40 w-full" aria-label="Rendering page" />;
	}
	const error = truncate(resultText(result));
	return (
		<div className="text-muted-foreground flex items-center gap-2 py-0.5 text-sm">
			<ToolStatusIcon status={status} />
			<span className="truncate">
				<span className="font-medium">Couldn't show {page?.title ?? "page"}</span>
				{error ? <span className="opacity-60"> {error}</span> : null}
			</span>
		</div>
	);
});
HtmlRenderPart.displayName = "HtmlRenderPart";

/**
 * Chat UI for the `html_render` tool: the agent's page, as part of its answer.
 * It shows in place while the turn runs. Once the turn settles the call sits
 * inside the "Worked for …" fold (see `isFoldHoistedPart`); a shown page then
 * renders nothing there, because the message shows it right below the fold
 * (`FoldHoistedParts`), so work on either side of it folds as one. A failed
 * call stays in the fold with the rest of the work.
 */
export const HtmlRenderToolUI: ToolCallMessagePartComponent = (props) =>
	useIsInTurnWorkFold() && showsHoistedPage(props) ? null : <HtmlRenderPart {...props} />;
HtmlRenderToolUI.displayName = "HtmlRenderToolUI";
