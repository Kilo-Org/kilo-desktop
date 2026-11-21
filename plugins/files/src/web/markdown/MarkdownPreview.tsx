import { MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";
import type { MarkdownRendererExtension } from "@kilo-desktop/ui/lib/markdown-extension";
import { markdownIslandHtml } from "@kilo-desktop/ui/lib/markdown-islands";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";
import { useEffect, useState, type MouseEvent } from "react";

import type { FileReadResult } from "../../contracts/models.js";
import type { ReadFile } from "../documents.js";

function resolveRelativePath(currentPath: string, target: string): string | null {
	const withoutFragment = target.split(/[?#]/u, 1)[0] ?? "";
	if (
		!withoutFragment ||
		/^[a-z][a-z\d+.-]*:/iu.test(withoutFragment) ||
		withoutFragment.startsWith("/")
	) {
		return null;
	}
	const result: string[] = currentPath.split("/").slice(0, -1);
	for (const segment of withoutFragment.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (result.length === 0) return null;
			result.pop();
		} else {
			result.push(segment);
		}
	}
	return result.join("/");
}

function MarkdownImage({
	alt,
	src,
	currentPath,
	workspaceDirectory,
	read,
}: {
	readonly alt?: string;
	readonly src?: string;
	readonly currentPath: string;
	readonly workspaceDirectory: string;
	readonly read: ReadFile;
}) {
	const [image, setImage] = useState<FileReadResult | null>(null);
	const relativePath = src ? resolveRelativePath(currentPath, src) : null;
	useEffect(() => {
		let active = true;
		if (!relativePath) return;
		void read({ workspaceDirectory, relativePath }).then(
			(result) => {
				if (active) setImage(result);
			},
			() => {
				if (active) setImage(null);
			},
		);
		return () => {
			active = false;
		};
	}, [read, relativePath, workspaceDirectory]);
	if (image?.kind !== "image") return <span className="text-muted-foreground">{alt ?? src}</span>;
	return (
		<img
			alt={alt ?? ""}
			className="my-4 max-h-[70vh] max-w-full rounded-lg border object-contain"
			src={`data:${image.mimeType};base64,${image.base64}`}
		/>
	);
}

/** Reads an image's `src` from the HTML Words generated for it. */
function imageSource(html: string): { src: string; alt: string } | null {
	const template = document.createElement("template");
	template.innerHTML = html;
	const image = template.content.querySelector("img");
	const src = image?.getAttribute("src");
	return image && src ? { src, alt: image.getAttribute("alt") ?? "" } : null;
}

interface PreviewLocation {
	readonly currentPath: string;
	readonly workspaceDirectory: string;
	readonly read: ReadFile;
	readonly onOpenFile: (relativePath: string) => void;
}

/**
 * The preview's own extension: a relative link opens that workspace file, and
 * each image is an island that loads a relative one through kilo.files (the
 * renderer cannot fetch workspace paths itself) and shows any other as its
 * alt text.
 */
function createPreviewExtension(location: PreviewLocation): MarkdownRendererExtension {
	return {
		components: {
			img: (html) => {
				const image = imageSource(html);
				return image ? markdownIslandHtml("span", "workspace-image", image) : html;
			},
		},
		islands: {
			"workspace-image": {
				render: (data) =>
					typeof data.src === "string" ? (
						<MarkdownImage
							src={data.src}
							currentPath={location.currentPath}
							read={location.read}
							workspaceDirectory={location.workspaceDirectory}
							{...(typeof data.alt === "string" && data.alt ? { alt: data.alt } : {})}
						/>
					) : null,
			},
		},
		onClick: (event: MouseEvent<HTMLElement>) => {
			const href = (event.target as Element | null)?.closest?.("a[href]")?.getAttribute("href");
			const target = href ? resolveRelativePath(location.currentPath, href) : null;
			if (!target) return;
			event.preventDefault();
			location.onOpenFile(target);
		},
	};
}

export function MarkdownPreview({
	contents,
	relativePath,
	workspaceDirectory,
	codeTheme,
	read,
	onOpenFile,
}: {
	readonly contents: string;
	readonly relativePath: string;
	readonly workspaceDirectory: string;
	/** The Shiki theme to highlight code blocks in. */
	readonly codeTheme?: string;
	readonly read: ReadFile;
	readonly onOpenFile: (relativePath: string) => void;
}) {
	const callbacks = useLatestRef({ read, onOpenFile });
	// The renderer starts over when its extensions change, which remounts
	// every island (diagrams restart, images refetch), so they change only
	// with the file's location; the callbacks are read when used.
	const extensions = [
		createPreviewExtension({
			currentPath: relativePath,
			workspaceDirectory,
			read: (args) => callbacks.current.read(args),
			onOpenFile: (path) => callbacks.current.onOpenFile(path),
		}),
	];
	return (
		<MarkdownContent
			className="min-h-0 max-w-none flex-1 overflow-auto px-6 py-5"
			data-qa-id="files-markdown-preview"
			extensions={extensions}
			text={contents}
			{...(codeTheme ? { codeTheme } : {})}
		/>
	);
}
