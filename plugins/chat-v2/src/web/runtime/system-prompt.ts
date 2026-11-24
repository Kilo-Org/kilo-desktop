import { HTML_RENDER_SYSTEM_PROMPT } from "../../contracts";

export interface PromptFolder {
	readonly path: string;
	readonly isPrimary: boolean;
}

/** Origin's workspace context: the folders the chat may work in, the primary one first. */
export function workspaceSystemPrompt(folders: readonly PromptFolder[]): string | undefined {
	const primary = folders.find((folder) => folder.isPrimary);
	if (!primary) return undefined;
	const additional = folders.filter((folder) => !folder.isPrimary);
	return [
		"Workspace context for this session:",
		`- Primary folder (default working directory): ${JSON.stringify(primary.path)}`,
		...additional.map((folder) => `- Additional workspace folder: ${JSON.stringify(folder.path)}`),
		"All listed workspace folders are in scope and may be read from and written to.",
		"Use the primary folder as the default working directory, but consider every listed folder when locating or changing relevant files.",
	].join("\n");
}

/**
 * A session's workspace folders as its chat sees them: in a worktree the
 * worktree stands in for the primary folder.
 */
export function sessionFolders(
	folders: readonly PromptFolder[],
	directory: string | null,
): PromptFolder[] {
	return folders.map((folder) =>
		folder.isPrimary && directory ? { path: directory, isPrimary: true } : folder,
	);
}

/**
 * The workspace context, when to show visuals (`html_render`), and kilo.core's
 * session-config instructions, as one system prompt.
 */
export function chatSystemPrompt(
	folders: readonly PromptFolder[],
	instructions: readonly string[],
): string {
	return [workspaceSystemPrompt(folders), HTML_RENDER_SYSTEM_PROMPT, ...instructions]
		.filter((part): part is string => Boolean(part?.trim()))
		.join("\n\n");
}
