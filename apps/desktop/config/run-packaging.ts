import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import { withStampedDesktopPackageJson } from "./stamp-desktop-version.js";

const FORGE_COMMANDS = ["make", "package", "publish"] as const;
type ForgeCommand = (typeof FORGE_COMMANDS)[number];

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(desktopRoot, "package.json");

function parseForgeCommand(value: string | undefined): ForgeCommand {
	for (const command of FORGE_COMMANDS) {
		if (command === value) return command;
	}
	throw new Error(
		`Unsupported Forge command: ${value ?? "(missing)"}. Expected ${FORGE_COMMANDS.join(", ")}.`,
	);
}

const [command, ...forgeArgs] = process.argv.slice(2);

await withStampedDesktopPackageJson(manifestPath, process.env, async () => {
	await execa("electron-forge", [parseForgeCommand(command), ...forgeArgs], {
		cwd: desktopRoot,
		stdio: "inherit",
	});
});
