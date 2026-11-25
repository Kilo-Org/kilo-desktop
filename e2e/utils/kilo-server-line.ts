import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { packagedResourcesDirectory } from "./paths.js";

/** The Kilo server line a build ships (docs/adr/003-kilo-server-line.md). */
export type KiloServerLine = "v1" | "v2";

export interface PackagedKiloCli {
	readonly line: KiloServerLine;
	readonly executable: string;
	/** A command that initializes providers and exits. */
	readonly warmUpArgs: readonly string[];
}

/**
 * The CLI each server line packages. v2's subcommands talk to a shared
 * background service unless `--standalone` gives them a private server, so
 * the warm-up never starts or touches one.
 */
const SERVER_LINE_CLIS = [
	{ line: "v1", name: "kilo", warmUpArgs: ["models", "kilo"] },
	{ line: "v2", name: "kilo2", warmUpArgs: ["models", "--standalone"] },
] as const;

/**
 * The packaged CLI lives at `<Resources>/kilo/<target>/bin/<name>[.exe]`,
 * `kilo` on the v1 server line and `kilo2` on v2; a build carries one line.
 *
 * Packaging copies the whole staging root, which can also hold an interrupted
 * `.staging-*` directory or a `<target>.previous` backup with the same
 * layout. Only a completed staging sits in the directory named after the
 * `target` recorded in its own `staged.json`, so that is the one the app runs.
 */
export function packagedKiloCli(): PackagedKiloCli | undefined {
	const kiloRoot = path.join(packagedResourcesDirectory(), "kilo");
	if (!existsSync(kiloRoot)) return undefined;
	const suffix = process.platform === "win32" ? ".exe" : "";
	for (const directory of readdirSync(kiloRoot)) {
		if (stagedTarget(path.join(kiloRoot, directory)) !== directory) continue;
		for (const { line, name, warmUpArgs } of SERVER_LINE_CLIS) {
			const executable = path.join(kiloRoot, directory, "bin", `${name}${suffix}`);
			if (existsSync(executable)) return { line, executable, warmUpArgs };
		}
	}
	return undefined;
}

function stagedTarget(stagingDirectory: string): string | undefined {
	try {
		const manifest = JSON.parse(
			readFileSync(path.join(stagingDirectory, "staged.json"), "utf8"),
		) as { target?: unknown };
		return typeof manifest.target === "string" ? manifest.target : undefined;
	} catch {
		return undefined;
	}
}

let cachedLine: KiloServerLine | undefined;

/**
 * The server line of the packaged app under test, read from the CLI it
 * carries so a run follows the build rather than an environment variable.
 * Without a packaged CLI, `KILO_SERVER_LINE` decides (v1 when unset).
 */
export function packagedServerLine(): KiloServerLine {
	cachedLine ??= packagedKiloCli()?.line ?? (process.env.KILO_SERVER_LINE === "v2" ? "v2" : "v1");
	return cachedLine;
}
