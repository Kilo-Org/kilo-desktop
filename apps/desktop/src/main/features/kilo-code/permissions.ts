import type { Workspace } from "./workspace-capability.js";

export interface ExternalDirectoryRule {
	readonly permission: "external_directory";
	readonly pattern: string;
	readonly action: "allow" | "ask";
}

function normalizeFolderPath(folderPath: string): string {
	const normalized = folderPath.replace(/[\\/]+$/, "");
	return normalized || folderPath;
}

function rulesForPath(folderPath: string, action: "allow" | "ask"): ExternalDirectoryRule[] {
	const normalized = normalizeFolderPath(folderPath);
	return [
		{ permission: "external_directory", pattern: normalized, action },
		{ permission: "external_directory", pattern: `${normalized}/*`, action },
	];
}

export function deduplicatePermissionRules(
	rules: readonly ExternalDirectoryRule[],
): ExternalDirectoryRule[] {
	const seen = new Set<string>();
	return rules.filter((rule) => {
		const key = `${rule.permission}\0${rule.pattern}\0${rule.action}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function buildReferenceFolderRules(workspace: Workspace | null): ExternalDirectoryRule[] {
	if (!workspace) return [];
	return deduplicatePermissionRules(
		workspace.folders
			.filter((folder) => !folder.isPrimary)
			.flatMap((folder) => rulesForPath(folder.path, "allow")),
	);
}

export function reconcileReferenceFolderRules(
	before: Workspace | null,
	after: Workspace | null,
): ExternalDirectoryRule[] {
	const beforePaths = new Set(
		(before?.folders ?? [])
			.filter((folder) => !folder.isPrimary)
			.map((folder) => normalizeFolderPath(folder.path)),
	);
	const afterPaths = new Set(
		(after?.folders ?? [])
			.filter((folder) => !folder.isPrimary)
			.map((folder) => normalizeFolderPath(folder.path)),
	);

	return deduplicatePermissionRules([
		...[...afterPaths]
			.filter((folderPath) => !beforePaths.has(folderPath))
			.flatMap((folderPath) => rulesForPath(folderPath, "allow")),
		...[...beforePaths]
			.filter((folderPath) => !afterPaths.has(folderPath))
			.flatMap((folderPath) => rulesForPath(folderPath, "ask")),
	]);
}
