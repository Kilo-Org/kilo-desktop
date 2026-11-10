import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type { Pane, Panes } from "@kilo-desktop/plugin-work-sessions/contracts";

import { FILE_OBJECT_TYPE, FILE_PANE_METADATA, FILES_PANE_KIND } from "../contracts/panes";

export interface OpenFileInput {
	readonly workSessionId: string;
	/** The file's absolute path. */
	readonly path: string;
	readonly line?: number | undefined;
	readonly column?: number | undefined;
}

/**
 * Opens a file in its work session through kilo.work-sessions' openers (a
 * notebook plugin may claim `.ipynb`), then asks a Files pane to reveal the
 * line and column. Null when no opener takes files.
 */
export async function openFile(
	panes: DomainObjectHandle<typeof Panes>,
	{ workSessionId, path, line, column }: OpenFileInput,
): Promise<Pane | null> {
	const pane = await panes.methods.openObject({
		workSessionId,
		ref: { type: FILE_OBJECT_TYPE, id: path },
	});
	if (!pane || pane.kind !== FILES_PANE_KIND || line === undefined) return pane;
	const {
		[FILE_PANE_METADATA.line]: _line,
		[FILE_PANE_METADATA.column]: _column,
		...metadata
	} = pane.metadata;
	return panes.methods.update({
		workSessionId,
		paneId: pane.id,
		metadata: {
			...metadata,
			[FILE_PANE_METADATA.line]: String(line),
			...(column === undefined ? {} : { [FILE_PANE_METADATA.column]: String(column) }),
			[FILE_PANE_METADATA.revealRequest]: crypto.randomUUID(),
		},
	});
}
