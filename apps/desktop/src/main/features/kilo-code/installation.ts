import { existsSync } from "node:fs";
import path from "node:path";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk/main";

import type { KiloInstallation } from "./KiloServerManager.js";
import { getKiloCliArtifact } from "./cli/artifacts.js";

export interface KiloInstallationResolutionOptions {
	readonly resourceRoots: readonly string[];
	readonly environment?: NodeJS.ProcessEnv;
	readonly platform?: NodeJS.Platform;
	readonly arch?: NodeJS.Architecture;
	readonly exists?: (candidatePath: string) => boolean;
}

export function resolveKiloInstallation(
	options: KiloInstallationResolutionOptions,
): KiloInstallation {
	const environment = options.environment ?? process.env;
	const artifact = getKiloCliArtifact(options.platform, options.arch);
	const override = environment.KILO_CODE_CLI_PATH?.trim();
	if (override) {
		const executablePath = path.resolve(override);
		return {
			executablePath,
			treeSitterWasmDirectory: path.join(path.dirname(executablePath), "tree-sitter"),
		};
	}

	const exists = options.exists ?? existsSync;
	const binDirectories = options.resourceRoots.map((root) =>
		path.join(root, artifact.target, "bin"),
	);
	const binDirectory = binDirectories.find((candidate) =>
		exists(path.join(candidate, artifact.executable)),
	);
	if (!binDirectory) {
		throw new FeatureError(
			`Bundled Kilo CLI is missing from the configured resource roots. Run pnpm fetch:kilo.`,
			"BUSINESS",
		);
	}
	return {
		executablePath: path.join(binDirectory, artifact.executable),
		treeSitterWasmDirectory: path.join(binDirectory, "tree-sitter"),
	};
}
