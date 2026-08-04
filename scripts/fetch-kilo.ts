import path from "node:path";
import { fileURLToPath } from "node:url";

import { KILO_CLI_VERSION } from "../apps/desktop/src/main/features/kilo-code/cli-distribution/artifacts.js";
import { stageKiloCli } from "../apps/desktop/src/main/features/kilo-code/cli-distribution/stage.js";
import {
	hasAzureWindowsSigningCredentials,
	signWindowsFile,
} from "../apps/desktop/config/windows-sign.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resourceRoot = path.join(
	workspaceRoot,
	"apps/desktop/src/main/features/kilo-code/resources/kilo",
);
const result = await stageKiloCli({
	resourceRoot,
	...(hasAzureWindowsSigningCredentials(process.env) ? { signExecutable: signWindowsFile } : {}),
});

console.log(
	result.staged
		? `Staged ${result.artifact.packageName}@${KILO_CLI_VERSION} for ${result.artifact.target}.`
		: `Kilo CLI ${KILO_CLI_VERSION} is already staged for ${result.artifact.target}.`,
);
