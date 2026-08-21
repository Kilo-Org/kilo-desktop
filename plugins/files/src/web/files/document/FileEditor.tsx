import type { FileContents, FileOptions } from "@pierre/diffs";
import { Editor, type EditorOptions } from "@pierre/diffs/edit";
import { EditProvider, File, Virtualizer } from "@pierre/diffs/react";
import { memo, useMemo, type ReactNode } from "react";

interface FileEditorProps {
	readonly relativePath: string;
	readonly contents: string;
	readonly revealLine: number | undefined;
	readonly editable: boolean;
	readonly theme: "dark" | "light";
	readonly reloadVersion: number;
	readonly documentRevision: string | null;
	readonly editorOptions: EditorOptions<undefined>;
}

const FILE_EDITOR_SURFACE_CSS = `
	:host {
		--diffs-bg: transparent !important;
		--diffs-light-bg: transparent !important;
		--diffs-dark-bg: transparent !important;
		background-color: transparent !important;
		color: var(--foreground) !important;
	}
`;

function createEditor(options: EditorOptions<undefined>): Editor<undefined> {
	return new Editor(options);
}

export function FilesEditProvider({ children }: { readonly children: ReactNode }) {
	return <EditProvider createEditor={createEditor}>{children}</EditProvider>;
}

export const FileEditor = memo(function FileEditor({
	relativePath,
	contents,
	revealLine,
	editable,
	theme,
	reloadVersion,
	documentRevision,
	editorOptions,
}: FileEditorProps) {
	const file = useMemo<FileContents>(
		() => ({
			name: relativePath,
			contents,
			cacheKey: `${relativePath}:${documentRevision ?? "readonly"}:${String(reloadVersion)}`,
		}),
		[contents, documentRevision, relativePath, reloadVersion],
	);
	const options = useMemo<FileOptions<undefined>>(
		() => ({
			disableFileHeader: true,
			overflow: "wrap",
			theme: theme === "dark" ? "pierre-dark" : "pierre-light",
			themeType: theme,
			unsafeCSS: FILE_EDITOR_SURFACE_CSS,
		}),
		[theme],
	);

	return (
		<Virtualizer
			className="files-editor-scroll min-h-0 flex-1 overflow-auto"
			data-qa-id="files-editor"
		>
			<File
				className="min-h-full"
				disableWorkerPool
				edit={editable}
				editorOptions={editorOptions}
				file={file}
				options={options}
				{...(revealLine === undefined
					? {}
					: { selectedLines: { start: revealLine, end: revealLine } })}
			/>
		</Virtualizer>
	);
});
