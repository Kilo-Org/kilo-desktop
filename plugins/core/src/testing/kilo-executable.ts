import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { getKiloCliArtifact } from "../main/agent/cli-distribution/artifacts.js";

/**
 * The installed platform `kilo2` for integration tests, or undefined where its
 * package isn't installed (an unsupported platform), so those tests skip.
 */
export function bundledKiloExecutable(): string | undefined {
	try {
		const artifact = getKiloCliArtifact();
		const packageJson = createRequire(import.meta.url).resolve(
			`${artifact.packageName}/package.json`,
		);
		const executable = path.join(path.dirname(packageJson), "bin", artifact.executable);
		return existsSync(executable) ? executable : undefined;
	} catch {
		return undefined;
	}
}
