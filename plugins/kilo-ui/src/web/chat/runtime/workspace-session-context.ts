import type { PermissionRuleset } from "@kilocode/sdk/v2/client";

import type { KiloSessionPreparation } from "../../../contracts/chat/schemas.js";

export type WorkspaceFolder = KiloSessionPreparation["workspaceFolders"][number];

export function buildWorkspacePermissionRules(
	folders: readonly WorkspaceFolder[],
): PermissionRuleset {
	return folders
		.filter((folder) => !folder.isPrimary)
		.flatMap(({ path }) => [
			{ permission: "external_directory", pattern: path, action: "allow" as const },
			{ permission: "external_directory", pattern: `${path}/*`, action: "allow" as const },
		]);
}

export function buildWorkspaceSystemPrompt(
	folders: readonly WorkspaceFolder[],
): string | undefined {
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
