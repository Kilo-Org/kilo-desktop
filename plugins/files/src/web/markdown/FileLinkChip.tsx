import type { ComponentProps } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import type { MarkdownFileLinkTarget } from "./markdown-file-links.js";
import { PierreFileIcon } from "../file-icons/PierreFileIcon.js";

export type FileLinkChipProps = ComponentProps<"a"> & {
	readonly fileTarget: MarkdownFileLinkTarget;
	readonly parentSuffix?: string;
	readonly onOpenFile: (target: MarkdownFileLinkTarget) => void;
};

function basename(path: string): string {
	return path.replaceAll("\\", "/").split("/").at(-1) ?? path;
}

export function FileLinkChip({
	fileTarget,
	parentSuffix,
	onOpenFile,
	href,
	onClick,
	className,
	children: _children,
	...props
}: FileLinkChipProps) {
	const sourcePosition = fileTarget.line
		? `L${String(fileTarget.line)}${fileTarget.column ? `:C${String(fileTarget.column)}` : ""}`
		: null;

	return (
		<a
			{...props}
			href={href}
			title={props.title ?? fileTarget.relativePath}
			className={cn(
				"aui-md-a border-border-subtle bg-accent/40 text-foreground hover:bg-muted inline-flex max-w-full items-center gap-[0.33em] rounded-[0.5em] border px-[0.5em] py-[0.08em] align-middle text-[0.875em] leading-[1.1] font-medium no-underline transition-colors",
				className,
			)}
			data-qa-id="markdown-file-link"
			onClick={(event) => {
				onClick?.(event);
				if (
					event.defaultPrevented ||
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey
				) {
					return;
				}
				event.preventDefault();
				onOpenFile(fileTarget);
			}}
		>
			<PierreFileIcon className="size-[1.17em] opacity-85" path={fileTarget.relativePath} />
			<span className="truncate leading-tight">
				{basename(fileTarget.relativePath)}
				{parentSuffix ? ` · ${parentSuffix}` : ""}
				{sourcePosition ? ` · ${sourcePosition}` : ""}
			</span>
		</a>
	);
}
