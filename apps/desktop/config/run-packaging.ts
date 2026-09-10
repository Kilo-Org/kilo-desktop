import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa, type ExecaError } from "execa";

import { getReleaseChannel } from "./release.js";
import {
	runForgeMakeWithDetachRetry,
	type ExecutionOutcome,
	type ForgeInvocation,
} from "./retry-forge-make.js";
import { withStampedDesktopPackageJson } from "./stamp-desktop-version.js";
import { applyWindowsPackagingTemp } from "./windows-packaging-temp.js";

const FORGE_COMMANDS = ["make", "package", "publish"] as const;
type ForgeCommand = (typeof FORGE_COMMANDS)[number];

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(desktopRoot, "package.json");

/**
 * Effectively-unbounded per-stream buffer for the darwin-`make` retry path.
 * A packaging run can print megabytes on a cold CI runner (electron-rebuild,
 * appdmg progress, notarization). We only tee into memory so we can inspect
 * output for the hdiutil-detach-ENOENT signature; hitting the default 100MB
 * cap would raise an unrelated `isMaxBuffer` error that the retry logic
 * cannot recognize, masking the real failure.
 */
const FORGE_MAKE_MAX_BUFFER = 1_000_000_000;

function parseForgeCommand(value: string | undefined): ForgeCommand {
	for (const command of FORGE_COMMANDS) {
		if (command === value) return command;
	}
	throw new Error(
		`Unsupported Forge command: ${value ?? "(missing)"}. Expected ${FORGE_COMMANDS.join(", ")}.`,
	);
}

/**
 * Volume titles that maker-dmg may leave mounted at `/Volumes/<title>` after
 * a crashed appdmg run. Mirrors `dmgVolumeTitle` in `forge.config.ts`. Kept
 * in sync manually: the source of truth is intentionally the forge config,
 * but we recompute here so a retry works even before forge.config imports.
 */
function dmgVolumeTitles(): string[] {
	if (process.platform !== "darwin") return [];
	const channel = getReleaseChannel(process.env);
	const channelTitle = channel.replace(/^./, (character) => character.toUpperCase());
	const active = channel === "prod" ? "Agentic" : `Agentic ${channelTitle}`;
	// Also try the plain "Agentic" title as a defensive fallback in case a
	// prior packaging step for another channel left a mount behind.
	return active === "Agentic" ? [active] : [active, "Agentic"];
}

async function runForgeTeed({ command, args }: ForgeInvocation): Promise<ExecutionOutcome> {
	try {
		const result = await execa(command, [...args], {
			cwd: desktopRoot,
			// Pipe so we can inspect output for the flake signature, but mirror it
			// to the parent streams in real time so CI logs still show progress.
			stdout: ["inherit", "pipe"],
			stderr: ["inherit", "pipe"],
			maxBuffer: FORGE_MAKE_MAX_BUFFER,
			all: false,
		});
		return {
			exitCode: result.exitCode ?? 0,
			stdout: typeof result.stdout === "string" ? result.stdout : "",
			stderr: typeof result.stderr === "string" ? result.stderr : "",
			failed: false,
		};
	} catch (error) {
		const execaError = error as ExecaError;
		return {
			exitCode: typeof execaError.exitCode === "number" ? execaError.exitCode : 1,
			stdout: typeof execaError.stdout === "string" ? execaError.stdout : "",
			stderr: typeof execaError.stderr === "string" ? execaError.stderr : String(error),
			failed: true,
		};
	}
}

async function forceDetach(volumePath: string): Promise<void> {
	await execa("hdiutil", ["detach", "-force", volumePath], { stdio: "inherit" });
}

async function runForgeInvocation(command: ForgeCommand, forgeArgs: string[]): Promise<void> {
	const shouldRetryDetach = command === "make" && process.platform === "darwin";

	if (!shouldRetryDetach) {
		// Preserve the original error surface (execa's ExecaError with exit
		// code, signal, stderr trailer) for every path that does not need
		// the flake-detection retry. `publish` in particular is streamed
		// unmodified so publisher-s3 progress is not buffered in memory.
		await execa("electron-forge", [command, ...forgeArgs], {
			cwd: desktopRoot,
			stdio: "inherit",
		});
		return;
	}

	const invocation: ForgeInvocation = { command: "electron-forge", args: [command, ...forgeArgs] };
	const outcome = await runForgeMakeWithDetachRetry(invocation, {
		volumeTitles: dmgVolumeTitles(),
		runForge: runForgeTeed,
		forceDetach,
	});

	if (outcome.failed) {
		throw new Error(`electron-forge ${command} failed with exit code ${outcome.exitCode}`);
	}
}

const [command, ...forgeArgs] = process.argv.slice(2);
const parsedCommand = parseForgeCommand(command);

await applyWindowsPackagingTemp();
await withStampedDesktopPackageJson(manifestPath, process.env, async () => {
	await runForgeInvocation(parsedCommand, forgeArgs);
});
