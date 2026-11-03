import { memo, useState } from "react";
import type {
	PartState,
	ToolCallMessagePartComponent,
	ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { DownloadIcon, Maximize2Icon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@kilo-desktop/ui/components/dialog";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";

import { HTML_RENDER_MAX_HEIGHT, readHtmlRenderArgs, type HtmlRenderInput } from "../../contracts";
import { isFoldHoistedPart, showsHoistedPage } from "../tools/activity-grouping";
import { ToolStatusIcon, resultText, truncate } from "../tools/tool-ui-shared";
import { useIsInTurnWorkFold } from "../tools/turn-work-fold-context";
import { HtmlRenderFrame } from "./HtmlRenderFrame";
import { useSaveHtmlPage } from "./use-save-html-page";

function HtmlRenderView({
	html,
	title,
	height,
	cacheKey,
}: HtmlRenderInput & { readonly cacheKey: string }) {
	const [fullScreen, setFullScreen] = useState(false);
	const saveToWorkspace = useSaveHtmlPage();
	return (
		<div className="group/html-render my-3" data-qa-id="kilo-html-render">
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
					aria-label={`Open ${title} full screen`}
					onClick={() => setFullScreen(true)}
				>
					<Maximize2Icon />
				</Button>
			</div>
			<Dialog open={fullScreen} onOpenChange={setFullScreen}>
				<DialogContent className="flex h-[calc(100vh-4rem)] max-w-[calc(100vw-4rem)] flex-col gap-0 p-0 sm:max-w-[calc(100vw-4rem)]">
					<DialogTitle className="border-b px-4 py-2.5 pr-12 text-sm">{title}</DialogTitle>
					{fullScreen ? (
						<div className="min-h-0 flex-1 px-6 py-4">
							<HtmlRenderFrame html={html} title={title} fit="fill" />
						</div>
					) : null}
				</DialogContent>
			</Dialog>
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

/** The pages among a settled turn's folded parts, in order. */
export function FoldHoistedParts({ parts }: { parts: readonly PartState[] }) {
	return parts.map((part) =>
		part.type === "tool-call" && isFoldHoistedPart(part) && showsHoistedPage(part) ? (
			<HtmlRenderPart
				key={part.toolCallId}
				toolCallId={part.toolCallId}
				args={part.args}
				status={part.status}
				result={part.result}
			/>
		) : null,
	);
}
