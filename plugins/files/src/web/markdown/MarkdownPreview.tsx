import { MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";
import type { MarkdownRendererComponents } from "@kilo-desktop/ui/lib/markdown-extension";
import { createMermaidMarkdownExtension } from "@kilo-desktop/ui/components/mermaid-diagram";
import { useContextKey } from "@kilo-desktop/kernel/web";
import { FocusRail } from "@kilo-desktop/ui/components/reading/focus-rail";
import { ReadingControl } from "@kilo-desktop/ui/components/reading/reading-control";
import { blockIndexAt, readingBlocks } from "@kilo-desktop/ui/lib/reading/blocks";
import { readingSurfaceTheme } from "@kilo-desktop/ui/lib/reading/reading-theme";
import { readingTypography } from "@kilo-desktop/ui/lib/reading/typography";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { FileReadResult } from "../../contracts/models.js";
import type { ReadFile } from "../documents.js";
import {
	FOCUS_FOOTNOTE,
	useFilesFocusContainer,
	useFilesFocusSession,
	useFilesReading,
	useFilesReadingPreferences,
	useFocusShortcut,
	type FileFocusTarget,
} from "../reading/files-reading.js";
import { useFocusSourceRegistration } from "../reading/use-files-focus-source.js";
import { createFilesPreviewMarkdownExtension } from "./FilesPreviewMarkdownExtension.js";

const mermaidExtension = createMermaidMarkdownExtension();

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
	readonly read: ReadFile;
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
	const extensions = useMemo(() => [fileLinks, mermaidExtension], [fileLinks]);
	// MarkdownContent rebuilds its component map whenever these identities change,
	// which remounts every rendered element (diagrams restart, images refetch).
	const components = useMemo<MarkdownRendererComponents>(
		() => ({
			img: ({ alt, src }) => (
				<MarkdownImage
					currentPath={relativePath}
					read={read}
					workspaceDirectory={workspaceDirectory}
					{...(alt ? { alt } : {})}
					{...(src ? { src } : {})}
				/>
			),
		}),
		[read, relativePath, workspaceDirectory],
	);
	const markdown = (
		<MarkdownContent
			className="max-w-none"
			components={components}
			extensions={extensions}
			text={contents}
		/>
	);
	// Without Reading Mode (no kilo.files window entry around it) the preview stands alone.
	if (!useFilesReading()) {
		return (
			<div className="min-h-0 flex-1 overflow-auto px-6 py-5" data-qa-id="files-markdown-preview">
				{markdown}
			</div>
		);
	}
	return (
		<ReadingMarkdownPreview hasText={contents.trim() !== ""}>{markdown}</ReadingMarkdownPreview>
	);
}

/**
 * The preview as a reading surface: set at the reading text size and
 * spacing, with "Focus from here", the Aa control and the Focus portal.
 */
function ReadingMarkdownPreview({ hasText, children }: { hasText: boolean; children: ReactNode }) {
	const context = useFilesReading();
	const reading = context?.reading;
	const preferences = useFilesReadingPreferences(reading);
	const secondary = useContextKey("kernel/secondaryWindow");
	const shortcut = useFocusShortcut();
	const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
	const surfaceStyle = useMemo(
		() =>
			readingTypography("chat", preferences.settings, preferences.textSizes.ui)
				.cssVars as CSSProperties,
		[preferences.settings, preferences.textSizes.ui],
	);
	const { themeId, mode } = preferences.appTheme;
	const readingTheme = useMemo(
		() => readingSurfaceTheme(preferences.settings, { themeId, mode }),
		[preferences.settings, themeId, mode],
	);
	const surface = () => scroller?.querySelector(".aui-md") ?? null;
	const targetNearMiddle = (): FileFocusTarget | null => {
		const root = surface();
		if (!root || !scroller) return null;
		const box = scroller.getBoundingClientRect();
		return {
			kind: "file",
			block: Math.max(0, blockIndexAt(readingBlocks(root), box.top + box.height / 2)),
		};
	};
	useFocusSourceRegistration({
		available: hasText,
		targetNearMiddle,
		reveal: (target) => {
			const root = surface();
			const block = root ? readingBlocks(root)[target.block] : undefined;
			block?.elements[0]?.scrollIntoView({ block: "center" });
		},
	});
	const enter = (source: "rail" | "reading-control", target = targetNearMiddle()) => {
		if (!context || !target) return;
		const root = surface();
		void context.reading.enter(context, target, source, root ? readingBlocks(root).length : 0);
	};
	return (
		<div
			className="relative flex min-h-0 flex-1 flex-col"
			{...readingTheme?.attributes}
			style={readingTheme?.style}
		>
			<div
				ref={setScroller}
				className="relative min-h-0 flex-1 overflow-auto px-6 py-5"
				data-qa-id="files-markdown-preview"
				data-reading-surface="file"
				style={surfaceStyle}
			>
				{children}
				{reading && !secondary && hasText ? (
					<FocusRail
						host={scroller}
						onFocusFrom={(target) => enter("rail", { kind: "file", block: target.index })}
						{...(shortcut ? { shortcut } : {})}
						qaId="files-focus-rail"
					/>
				) : null}
			</div>
			{reading && hasText ? (
				<div className="absolute right-4 bottom-4 z-10">
					<ReadingControl
						settings={preferences.settings}
						onChange={(patch, setting) => preferences.update(patch, setting, "file")}
						onReset={() => preferences.reset("file")}
						appTheme={preferences.appTheme}
						baseSize={preferences.textSizes.ui}
						inFocus={false}
						focusOn={false}
						onFocusChange={(on) => {
							if (on) enter("reading-control");
						}}
						focusAvailable={!secondary}
						{...(shortcut ? { focusShortcut: shortcut } : {})}
						footnote={FOCUS_FOOTNOTE}
						onOpenChange={(open) => {
							if (open) reading.track("reading-control-opened", { surface: "file" });
						}}
						qaId="files-reading"
						{...(preferences.presets ? { presets: preferences.presets } : {})}
					/>
				</div>
			) : null}
			<FilesFocusPortal>{children}</FilesFocusPortal>
		</div>
	);
}

/** The rendered Markdown, portalled into the Focus take-over while this pane is being read. */
function FilesFocusPortal({ children }: { children: ReactNode }) {
	const context = useFilesReading();
	const session = useFilesFocusSession(context?.reading);
	const container = useFilesFocusContainer(context?.reading);
	if (!context || !container || session?.paneId !== context.paneId) return null;
	return createPortal(
		<div data-reading-surface="file" data-qa-id="files-focus-markdown">
			{children}
		</div>,
		container,
	);
}
