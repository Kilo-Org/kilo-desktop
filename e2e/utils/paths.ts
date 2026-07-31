import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDirectory = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (parent of the e2e/ package). */
export const repoRoot = path.resolve(thisDirectory, "../..");

/** Packaged Electron binary produced by `electron-forge package`. */
export function packagedExecutable(): string {
	const packageDirectory = path.join(
		repoRoot,
		"apps/desktop/out",
		`Anaconda Agentic Desktop-${process.platform}-${process.arch}`,
	);
	switch (process.platform) {
		case "darwin":
			return path.join(
				packageDirectory,
				"Anaconda Agentic Desktop.app/Contents/MacOS/anaconda-agentic-desktop",
			);
		case "win32":
			return path.join(packageDirectory, "anaconda-agentic-desktop.exe");
		default:
			return path.join(packageDirectory, "anaconda-agentic-desktop");
	}
}
