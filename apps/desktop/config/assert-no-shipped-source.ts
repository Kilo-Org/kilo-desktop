import { readdir } from "node:fs/promises";
import path from "node:path";

const sourcemapPattern = /\.map$/;
const typeScriptSourcePattern = /\.(ts|tsx|mts|cts)$/;
const maxListedOffenders = 20;

/**
 * Last line of defence before app.asar is sealed: fails packaging if original
 * source would ship. Sourcemaps embed source verbatim in `sourcesContent`, and
 * workspace packages are bundled, so their TypeScript is never needed at
 * runtime. Third-party packages (including ones nested inside workspace
 * packages) are out of scope — they are already public.
 */
export async function assertNoShippedSource(
	buildPath: string,
	workspacePackageNames: readonly string[],
): Promise<void> {
	const workspaceOffenders = await Promise.all(
		workspacePackageNames.map((packageName) =>
			findFiles(
				path.join(buildPath, "node_modules", packageName),
				(file) =>
					!file.split(path.sep).includes("node_modules") &&
					(sourcemapPattern.test(file) || typeScriptSourcePattern.test(file)),
			),
		),
	);
	const offenders = [
		...(await findFiles(path.join(buildPath, ".vite"), (file) => sourcemapPattern.test(file))),
		...workspaceOffenders.flat(),
	];
	if (offenders.length === 0) return;
	const listed = offenders
		.slice(0, maxListedOffenders)
		.map((file) => `  ${path.relative(buildPath, file)}`);
	const remaining = offenders.length - listed.length;
	if (remaining > 0) listed.push(`  … and ${remaining} more`);
	throw new Error(
		`Refusing to package original source into app.asar (${offenders.length} files):\n${listed.join("\n")}`,
	);
}

async function findFiles(
	directory: string,
	include: (relativePath: string) => boolean,
): Promise<string[]> {
	let entries;
	try {
		entries = await readdir(directory, { recursive: true, withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => path.join(entry.parentPath, entry.name))
		.filter((file) => include(path.relative(directory, file)));
}
