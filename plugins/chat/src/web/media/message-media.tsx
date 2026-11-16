import type { PartState } from "@assistant-ui/react";
import { useAuiState } from "@assistant-ui/react";
import { useMemo } from "react";

import { HtmlRenderPart } from "../html-render/HtmlRenderToolUI";
import { isFoldHoistedPart, showsHoistedPage } from "../tools/activity-grouping";
import { useIsInTurnWorkFold } from "../tools/turn-work-fold-context";
import { ChatImage } from "./ChatImage";
import { fileName, savedImages, toolImageAttachments } from "./message-images";

/** The message's raw OpenCode parts, which carry what assistant-ui's parts leave out. */
function useOpenCodeParts(): unknown {
	return useAuiState((s) => {
		const custom = s.message.metadata?.custom as { opencode?: { parts?: unknown } } | undefined;
		return custom?.opencode?.parts;
	});
}

/**
 * An image the assistant attached to its reply. Inside a settled turn's fold
 * it renders nothing: the message shows it below the fold (`FoldHoistedParts`).
 */
export function AssistantImagePart({
	image,
	filename,
}: {
	readonly image: string;
	readonly filename?: string | undefined;
}) {
	if (useIsInTurnWorkFold()) return null;
	return (
		<div className="my-3" data-qa-id="chat-assistant-image">
			<ChatImage source={{ url: image }} filename={filename} />
		</div>
	);
}

/**
 * The images a tool call returned, under its row. Inside a settled turn's fold
 * they render nothing: the message shows them below the fold.
 */
export function ToolImageAttachments({ toolCallId }: { readonly toolCallId: string }) {
	const parts = useOpenCodeParts();
	const attachments = useMemo(() => toolImageAttachments(parts, toolCallId), [parts, toolCallId]);
	if (useIsInTurnWorkFold() || attachments.length === 0) return null;
	return (
		<div className="my-2 flex flex-wrap gap-2" data-qa-id="chat-tool-images">
			{attachments.map((attachment, index) => (
				<ChatImage
					key={`${String(index)}-${attachment.url.slice(0, 64)}`}
					source={{ url: attachment.url }}
					filename={attachment.filename}
					size="sm"
				/>
			))}
		</div>
	);
}

/**
 * The image files the turn wrote (a plot a script saved, an SVG the agent
 * wrote), read from the workspace and shown at the end of the message.
 */
export function TurnSavedImages() {
	const parts = useOpenCodeParts();
	const { images, more } = useMemo(() => savedImages(parts), [parts]);
	if (images.length === 0) return null;
	return (
		<div
			role="group"
			aria-label="Images saved in this turn"
			className="mt-3 flex flex-wrap items-end gap-2"
			data-qa-id="chat-saved-images"
		>
			{images.map((image) => (
				<ChatImage
					key={image.path}
					source={{ path: image.path, revision: image.revision }}
					alt={fileName(image.path)}
					size="sm"
					hideWhenUnavailable
				/>
			))}
			{more > 0 ? <span className="text-muted-foreground pb-1 text-xs">+{more} more</span> : null}
		</div>
	);
}

/**
 * What a settled turn's fold shows below it, in order: the agent's pages, the
 * images it attached, and the images its tools returned — the parts of the
 * answer that shouldn't hide with the work around them.
 */
export function FoldHoistedParts({ parts }: { parts: readonly PartState[] }) {
	return parts.map((part, index) => {
		if (part.type === "image") {
			return (
				<AssistantImagePart
					key={`image-${String(index)}`}
					image={part.image}
					filename={part.filename}
				/>
			);
		}
		if (part.type !== "tool-call") return null;
		if (isFoldHoistedPart(part)) {
			return showsHoistedPage(part) ? (
				<HtmlRenderPart
					key={part.toolCallId}
					toolCallId={part.toolCallId}
					args={part.args}
					status={part.status}
					result={part.result}
				/>
			) : null;
		}
		return <ToolImageAttachments key={part.toolCallId} toolCallId={part.toolCallId} />;
	});
}
