import { MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";
import { useEffect, useMemo, useState } from "react";

import type { FileReadResult, FilesServiceContract } from "../../../contracts/schemas.js";
import { createFilesPreviewMarkdownExtension } from "./FilesPreviewMarkdownExtension.js";

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
	readonly read: FilesServiceContract["read"];
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

export function MarkdownPreview({
	contents,
	relativePath,
	workspaceDirectory,
	read,
	onOpenFile,
}: {
	readonly contents: string;
	readonly relativePath: string;
	readonly workspaceDirectory: string;
	readonly read: FilesServiceContract["read"];
	readonly onOpenFile: (relativePath: string) => void;
}) {
	const fileLinks = useMemo(
		() =>
			createFilesPreviewMarkdownExtension({
				workspaceDirectory,
				relativePath,
				onOpenFile,
			}),
		[onOpenFile, relativePath, workspaceDirectory],
	);
	return (
		<MarkdownContent
			className="max-w-none overflow-auto px-6 py-5"
			components={{
				img: ({ alt, src }) => (
					<MarkdownImage
						currentPath={relativePath}
						read={read}
						workspaceDirectory={workspaceDirectory}
						{...(alt ? { alt } : {})}
						{...(src ? { src } : {})}
					/>
				),
			}}
			data-qa-id="files-markdown-preview"
			extensions={[fileLinks]}
			text={contents}
		/>
	);
}
