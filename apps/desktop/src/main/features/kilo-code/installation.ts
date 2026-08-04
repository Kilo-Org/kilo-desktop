import { existsSync } from "node:fs";
import path from "node:path";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk/main";

import { getKiloCliArtifact } from "$config/kilo-cli.js";

import type { KiloInstallation } from "./KiloServerManager.js";

export function resolveKiloInstallation(
	environment: NodeJS.ProcessEnv = process.env,
): KiloInstallation {
	const artifact = getKiloCliArtifact();
	const override = environment.KILO_CODE_CLI_PATH?.trim();
	if (override) {
		return {
			executablePath: path.resolve(override),
			treeSitterWasmDirectory: path.join(path.dirname(path.resolve(override)), "tree-sitter"),
		};
	}

	const packagedRoot = path.join(process.resourcesPath, "kilo", artifact.target, "bin");
	const developmentRoot = path.resolve(
		import.meta.dirname,
		"../../vendor/kilo",
		artifact.target,
		"bin",
	);
	const binDirectory = existsSync(path.join(packagedRoot, artifact.executable))
		? packagedRoot
		: developmentRoot;
	const executablePath = path.join(binDirectory, artifact.executable);
	if (!existsSync(executablePath)) {
		throw new FeatureError(
			`Bundled Kilo CLI is missing at ${executablePath}. Run pnpm fetch:kilo.`,
			"BUSINESS",
		);
	}
	return {
		executablePath,
		treeSitterWasmDirectory: path.join(binDirectory, "tree-sitter"),
	};
}
