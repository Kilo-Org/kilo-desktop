import { type FC } from "react";
import { CircleAlertIcon, FileTextIcon, XIcon } from "lucide-react";
import {
	AttachmentPrimitive,
	ComposerPrimitive,
	MessagePrimitive,
	useAuiState,
	useAui,
} from "@assistant-ui/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Avatar, AvatarImage, AvatarFallback } from "@kilo-desktop/ui/components/avatar";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { useFileObjectUrl } from "./file-object-url";
import { useLightboxItem, type LightboxItemInput } from "./lightbox/chat-lightbox";
import { TooltipIconButton } from "./tooltip-icon-button";

const useAttachmentFile = () =>
	useAuiState((s) =>
		s.attachment.type === "image" ? (s.attachment.file ?? undefined) : undefined,
	);

const useAttachmentSrc = () => {
	const file = useAttachmentFile();
	const src = useAuiState((s) =>
		s.attachment.type === "image" && !s.attachment.file
			? s.attachment.content?.find((part) => part.type === "image")?.image
			: undefined,
	);
	return useFileObjectUrl(file) ?? src;
};

/**
 * An image attachment in the viewer: a sent one joins the transcript's
 * gallery, an unsent (composer) one opens on its own.
 */
const useAttachmentLightbox = (gallery: boolean) => {
	const src = useAttachmentSrc();
	const file = useAttachmentFile();
	const name = useAuiState((s) => s.attachment.name);
	const input: LightboxItemInput | null = src
		? {
				kind: "image",
				src,
				...(file ? { file } : {}),
				...(name ? { alt: name, filename: name } : {}),
			}
		: null;
	return useLightboxItem(input, { gallery });
};

const AttachmentThumb: FC = () => {
	const src = useAttachmentSrc();

	return (
		<Avatar className="aui-attachment-tile-avatar h-full w-full rounded-none after:hidden">
			<AvatarImage
				src={src}
				alt="Attachment preview"
				className="aui-attachment-tile-image rounded-none object-cover"
			/>
			<AvatarFallback className="rounded-none">
				<FileTextIcon className="aui-attachment-tile-fallback-icon text-muted-foreground/80 size-6 stroke-[1.5]" />
			</AvatarFallback>
		</Avatar>
	);
};

const AttachmentUI: FC = () => {
	const aui = useAui();
	const isComposer = aui.attachment.source !== "message";

	const isImage = useAuiState((s) => s.attachment.type === "image");
	const typeLabel = useAuiState((s) => {
		const type = s.attachment.type;
		switch (type) {
			case "image":
				return "Image";
			case "document":
				return "Document";
			case "file":
				return "File";
			default:
				return type;
		}
	});

	const uploadState = useAuiState((s) =>
		s.attachment.status.type === "running"
			? "uploading"
			: s.attachment.status.type === "incomplete" && s.attachment.status.reason === "error"
				? "error"
				: undefined,
	);
	const isUploading = uploadState === "uploading";
	const isError = uploadState === "error";

	const errorMessage = useAuiState((s) =>
		s.attachment.status.type === "incomplete" && s.attachment.status.reason === "error"
			? (s.attachment.status.message ?? "Upload failed")
			: undefined,
	);
	const {
		ref: lightboxRef,
		open: openLightbox,
		lightbox,
		available: lightboxAvailable,
	} = useAttachmentLightbox(!isComposer);

	return (
		<Tooltip>
			<AttachmentPrimitive.Root
				className={cn(
					"aui-attachment-root relative",
					isComposer && "animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none",
					isImage && !isComposer && "aui-attachment-root-message only:*:first:size-24",
				)}
			>
				<TooltipTrigger
					render={
						<button
							type="button"
							ref={lightboxRef}
							onClick={openLightbox}
							data-qa-id="chat-attachment-tile"
							className={cn(
								"aui-attachment-tile bg-muted block hover:after:bg-foreground/10 focus-visible:ring-ring/50 relative size-14 cursor-pointer overflow-hidden rounded-[calc(var(--composer-radius)-var(--composer-padding))] transition-transform outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-black/10 after:transition-colors after:ring-inset focus-visible:ring-3 active:scale-[0.96] motion-reduce:transition-none dark:after:ring-white/10",
								isError && "after:ring-destructive/60 dark:after:ring-destructive/60",
								lightboxAvailable && "cursor-zoom-in",
							)}
							aria-label={`${typeLabel} attachment${
								isError ? ", upload failed" : isUploading ? ", uploading" : ""
							}`}
						/>
					}
				>
					<AttachmentThumb />
					{isUploading && (
						<span
							aria-hidden="true"
							className="aui-attachment-tile-uploading bg-background/60 animate-in fade-in-0 absolute inset-0 flex items-center justify-center backdrop-blur-[2px] motion-reduce:animate-none"
						>
							<Spinner className="text-muted-foreground size-4" />
						</span>
					)}
					{isError && (
						<span
							aria-hidden="true"
							className="aui-attachment-tile-error bg-background/70 animate-in fade-in-0 absolute inset-0 flex items-center justify-center backdrop-blur-[2px] motion-reduce:animate-none"
						>
							<CircleAlertIcon className="text-destructive size-4" />
						</span>
					)}
				</TooltipTrigger>
				{lightbox}
				{isComposer && <AttachmentRemove />}
			</AttachmentPrimitive.Root>
			<TooltipContent side="top">
				<AttachmentPrimitive.Name />
				{errorMessage && <p className="aui-attachment-error-message">{errorMessage}</p>}
			</TooltipContent>
		</Tooltip>
	);
};

const AttachmentRemove: FC = () => {
	return (
		<AttachmentPrimitive.Remove
			render={
				<TooltipIconButton
					tooltip="Remove file"
					className="aui-attachment-tile-remove absolute end-1 top-1 size-5 rounded-full bg-black/50! text-white backdrop-blur-sm after:absolute after:-inset-1.5 hover:bg-black/70! hover:text-white! active:scale-[0.96] motion-reduce:transition-none"
					side="top"
				/>
			}
		>
			<XIcon className="aui-attachment-remove-icon size-3 stroke-[2.5]" />
		</AttachmentPrimitive.Remove>
	);
};

export const UserMessageAttachments: FC = () => {
	return (
		<div className="aui-user-message-attachments-end col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-2">
			<MessagePrimitive.Attachments>{() => <AttachmentUI />}</MessagePrimitive.Attachments>
		</div>
	);
};

export const ComposerAttachments: FC = () => {
	return (
		<div className="aui-composer-attachments flex w-full flex-row items-center gap-2 overflow-x-auto empty:hidden">
			<ComposerPrimitive.Attachments>{() => <AttachmentUI />}</ComposerPrimitive.Attachments>
		</div>
	);
};
