import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Interim WebMCP↔Kilo bridge — see #102.
 *
 * `@mcp-b/webmcp-local-relay` ships an ESM CLI (`bin/webmcp-local-relay ->
 * dist/cli.mjs`) that requires a Node runtime. Forge stages its lockfile-pinned
 * dependency closure in `resources/webmcp-relay` so the child process does not
 * need the app's remaining node_modules outside ASAR. That extra-resource path
 * also keeps Squirrel nupkg entries under Windows MAX_PATH.
 * Kilo spawns the Kilo Desktop executable with `ELECTRON_RUN_AS_NODE=1`,
 * which requires `FuseV1Options.RunAsNode: true` in `forge.config.ts`.
 *
 * Once Kilo Code lands the native `type: "webmcp"` MCP transport tracked in
 * #102, this whole file and the fuse flip go away.
 */

export interface ResolvedWebMcpRelay {
	/** Absolute path to the CLI entry script (`dist/cli.mjs`). */
	readonly entry: string;
	/** Version reported by the relay package (matches the sha-verified assets). */
	readonly version: string;
}

/**
 * Options accepted by `resolveWebMcpRelayEntry`. The defaults are wired to
 * production; tests inject stubs.
 */
export interface ResolveWebMcpRelayOptions {
	/** Plugin-owned runtime root staged outside ASAR in packaged builds. */
	readonly runtimeRoot?: string;
	readonly exists?: (filePath: string) => boolean;
	readonly requireResolve?: (specifier: string) => string;
	readonly readPackageJson?: (packageJsonPath: string) => {
		version: string;
		bin?: string | Record<string, string>;
	};
}
const PACKAGE_NAME = "@mcp-b/webmcp-local-relay";
const DEFAULT_REQUIRE = createRequire(import.meta.url);

function defaultReadPackageJson(packageJsonPath: string): {
	version: string;
	bin?: string | Record<string, string>;
} {
	// synchronous read: called once at plugin boot, kept synchronous to keep the
	// config initialization's control flow (mkdir → resolve → write) easy to reason about.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return DEFAULT_REQUIRE(packageJsonPath) as {
		version: string;
		bin?: string | Record<string, string>;
	};
}

/**
 * Rewrites a plugin asset path that lives inside an unpacked asar bundle so
 * the child runtime has a real filesystem path. Electron's plugin resolver
 * returns paths with `.asar/` embedded even when Forge marked the asset for
 * extraction to `.asar.unpacked/`.
 *
 * Safe on unpackaged (dev/test) paths: no `.asar` segment → identity.
 */
export function translateAsarPath(inputPath: string): string {
	// Match the segment as a directory component to avoid collisions with files
	// literally named `foo.asar` (nonexistent in our tree but defensive).
	const asarSegment = `${path.sep}app.asar${path.sep}`;
	const unpackedSegment = `${path.sep}app.asar.unpacked${path.sep}`;
	if (!inputPath.includes(asarSegment)) return inputPath;
	return inputPath.replace(asarSegment, unpackedSegment);
}

/**
 * Locate the bundled `@mcp-b/webmcp-local-relay` CLI entry. Returns an
 * absolute filesystem path suitable for `child_process.spawn(execPath, [entry])`.
 *
 * Throws with a clear message if the package or its `bin` cannot be resolved
 * so the config initialization fails loud rather than writing a broken `kilo.json`.
 */
export function resolveWebMcpRelayEntry(
	options: ResolveWebMcpRelayOptions = {},
): ResolvedWebMcpRelay {
	const requireResolve = options.requireResolve ?? DEFAULT_REQUIRE.resolve;
	const readPackageJson = options.readPackageJson ?? defaultReadPackageJson;
	const exists = options.exists ?? existsSync;

	let packageRoot: string | undefined;
	if (options.runtimeRoot) {
		const runtimePackageRoot = path.join(
			translateAsarPath(options.runtimeRoot),
			"node_modules",
			...PACKAGE_NAME.split("/"),
		);
		if (exists(path.join(runtimePackageRoot, "package.json"))) {
			packageRoot = runtimePackageRoot;
		} else if (options.runtimeRoot.includes(`${path.sep}app.asar${path.sep}`)) {
			throw new Error(`Packaged WebMCP runtime is missing from ${runtimePackageRoot}.`);
		}
	}
	if (!packageRoot) {
		// Development resolves the package's exported main entry and walks up to
		// its root. Packaged builds always provide the isolated runtimeRoot above.
		let mainEntry: string;
		try {
			mainEntry = requireResolve(PACKAGE_NAME);
		} catch (cause) {
			throw new Error(
				`Failed to resolve ${PACKAGE_NAME}. Packaged builds must stage the ` +
					`${PACKAGE_NAME} runtime through @kilo-desktop/webmcp-relay-runtime.`,
				{ cause },
			);
		}
		packageRoot = path.dirname(path.dirname(mainEntry)); // .../dist/index.mjs → .../
	}
	const packageJsonPath = path.join(packageRoot, "package.json");

	let manifest: { version: string; bin?: string | Record<string, string> };
	try {
		manifest = readPackageJson(packageJsonPath);
	} catch (cause) {
		throw new Error(`Failed to read ${packageJsonPath}.`, { cause });
	}

	const binRelative =
		typeof manifest.bin === "string"
			? manifest.bin
			: manifest.bin?.[PACKAGE_NAME.split("/").pop() as string];
	if (!binRelative) {
		throw new Error(
			`${PACKAGE_NAME}@${manifest.version} does not declare an expected 'bin' entry.`,
		);
	}
	const rawBinPath = path.join(packageRoot, binRelative);
	const entry = translateAsarPath(rawBinPath);
	return { entry, version: manifest.version };
}
