import { useQuery } from "@tanstack/react-query";
import { ImageOffIcon } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";

import { resolvePathInFolders } from "@kilo-desktop/plugin-workspaces/contracts";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { useChatConnection } from "../runtime/chat-connection";
import { directoryClient } from "../runtime/kilo-client";
import { useChatMarkdownContext } from "../thread/chat-markdown";
import { useLightboxItem, type LightboxItemInput } from "../thread/lightbox/chat-lightbox";
import { fileName, fileUrlPath, imageDataUrl } from "./message-images";

/** Where an image comes from: a URL the agent gave, or a workspace file it wrote. */
export type ChatImageSource =
	| { readonly url: string }
	| { readonly path: string; readonly revision?: string };

type Size = "md" | "sm";

interface ChatImageProps {
	readonly source: ChatImageSource;
	readonly alt?: string | undefined;
	readonly filename?: string | undefined;
	readonly size?: Size;
	/** Renders nothing for an image that can't be shown (a saved file deleted since). */
	readonly hideWhenUnavailable?: boolean;
}

const IMAGE_CLASS: Record<Size, string> = {
	md: "max-h-80 max-w-full",
	sm: "h-28 max-w-60",
};

function ViewableImage({
	src,
	alt,
	filename,
	size,
}: {
	readonly src: string;
	readonly alt: string;
	readonly filename?: string | undefined;
	readonly size: Size;
}) {
	const [loaded, setLoaded] = useState<string | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	const input = useMemo<LightboxItemInput | null>(
		() => (loaded === src ? { kind: "image", src, alt, ...(filename ? { filename } : {}) } : null),
		[loaded, src, alt, filename],
	);
	const viewer = useLightboxItem(input);
	if (failed === src) return <Unavailable name={filename ?? alt} />;
	const onKeyDown = (event: KeyboardEvent<HTMLImageElement>) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		viewer.open();
	};
	return (
		<>
			<img
				ref={viewer.ref}
				src={src}
				alt={alt}
				draggable={false}
				data-qa-id="chat-image"
				className={cn(
					"border-border-subtle bg-muted/30 block w-auto rounded-lg border object-contain",
					IMAGE_CLASS[size],
					viewer.available &&
						"focus-visible:ring-ring/50 cursor-zoom-in outline-none focus-visible:ring-3",
				)}
				role={viewer.available ? "button" : undefined}
				tabIndex={viewer.available ? 0 : undefined}
				aria-label={viewer.available ? `Open ${alt} in viewer` : undefined}
				onLoad={() => setLoaded(src)}
				onError={() => setFailed(src)}
				onClick={viewer.available ? viewer.open : undefined}
				onKeyDown={viewer.available ? onKeyDown : undefined}
			/>
			{viewer.lightbox}
		</>
	);
}

function Unavailable({ name }: { readonly name: string }) {
	return (
		<span
			className="text-muted-foreground flex items-center gap-1.5 py-1 text-xs"
			data-qa-id="chat-image-unavailable"
		>
			<ImageOffIcon aria-hidden="true" className="size-3.5" />
			Couldn't show {name}
		</span>
	);
}

function Placeholder({ size, name }: { readonly size: Size; readonly name: string }) {
	return (
		<Skeleton
			aria-label={`Loading ${name}`}
			className={cn("rounded-lg", size === "sm" ? "h-28 w-40" : "h-48 w-72")}
		/>
	);
}

/**
 * A workspace image file, read through the chat's Kilo client (the renderer
 * can't load `file:` URLs) and shown inline. Paths outside the chat's folders
 * aren't read.
 */
function WorkspaceImage({
	path,
	revision,
	alt,
	filename,
	size,
	hideWhenUnavailable,
}: {
	readonly path: string;
	readonly revision: string;
	readonly alt: string;
	readonly filename: string;
	readonly size: Size;
	readonly hideWhenUnavailable: boolean;
}) {
	const { connection } = useChatConnection();
	const folders = useChatMarkdownContext()?.workspaceFolders;
	const target = useMemo(
		() => (folders ? resolvePathInFolders(folders, path) : null),
		[folders, path],
	);
	const image = useQuery({
		queryKey: [
			"kilo.chat",
			"workspace-image",
			target?.workspaceDirectory,
			target?.relativePath,
			revision,
		],
		enabled: Boolean(connection && target?.relativePath),
		queryFn: async () => {
			const { data } = await directoryClient(connection!, target!.workspaceDirectory).file.read(
				{ path: target!.relativePath },
				{ throwOnError: true },
			);
			return imageDataUrl(data, target!.relativePath);
		},
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
	});

	if (!target?.relativePath || image.isError || image.data === null) {
		return hideWhenUnavailable ? null : <Unavailable name={filename} />;
	}
	if (!image.data) return <Placeholder size={size} name={filename} />;
	return <ViewableImage src={image.data} alt={alt} filename={filename} size={size} />;
}

/**
 * An image in a reply: inline data shown as is, a workspace file read in.
 * Once loaded it opens in the transcript's viewer. Remote images stay blocked
 * by the app's content policy, so they show as unavailable.
 */
export function ChatImage({
	source,
	alt,
	filename,
	size = "md",
	hideWhenUnavailable = false,
}: ChatImageProps) {
	const path = "path" in source ? source.path : fileUrlPath(source.url);
	const name = filename ?? (path ? fileName(path) : "image");
	const label = alt?.trim() || name;
	if (path) {
		return (
			<WorkspaceImage
				path={path}
				revision={"revision" in source ? (source.revision ?? "") : ""}
				alt={label}
				filename={name}
				size={size}
				hideWhenUnavailable={hideWhenUnavailable}
			/>
		);
	}
	if ("url" in source && source.url.startsWith("data:image/")) {
		return <ViewableImage src={source.url} alt={label} filename={filename} size={size} />;
	}
	return hideWhenUnavailable ? null : <Unavailable name={name} />;
}
