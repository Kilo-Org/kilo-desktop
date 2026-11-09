/**
 * App-local Visual C++ runtime for the Windows package.
 *
 * Some prebuilt native binaries we ship (the `@runtimed/node` napi-rs addon and
 * the `runtimed` daemon) link `VCRUNTIME140.dll` dynamically. That DLL comes from
 * the Visual C++ Redistributable, which clean Windows installs lack but every
 * build machine has (Visual Studio installs it into System32). The gap is
 * therefore invisible to CI boot tests and only surfaces on user machines, where
 * napi-rs misreports it as "Cannot find native binding".
 *
 * Windows resolves a binary's DLL dependencies from the binary's own directory
 * first. Node loads addons with LOAD_WITH_ALTERED_SEARCH_PATH, which searches
 * the addon's directory instead of Kilo.exe's, so each binary that needs the
 * runtime gets its own copy beside it. Copies come from Visual Studio's
 * `VC\Redist\MSVC` folder, the licensed source for redistribution.
 *
 * The audit is the regression guard: a redistributable-runtime import not
 * satisfied beside the importing binary blocks the build, because nothing else
 * in CI can observe it.
 */
import { copyFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import { readPeImportsFromFile, type PeImports, type PeMachine } from "./windows-pe-imports.js";

/** Redistributable VC++ 14.x runtime DLLs: absent from clean Windows, licensed to ship app-local. */
const REDISTRIBUTABLE_RUNTIME =
	/^(?:vcruntime140(?:_1|_threads)?|msvcp140(?:_1|_2|_atomic_wait|_codecvt_ids)?|concrt140|vccorlib140|vcomp140|vcamp140|mfc140u?|mfcm140u?)\.dll$/i;
/** Debug and pre-2015 runtimes: also absent from clean Windows, but not ours to ship. */
const UNSHIPPABLE_RUNTIME =
	/^(?:ucrtbased|vcruntime140(?:_1)?d|msvcp140(?:_\w+)?d|concrt140d|vccorlib140d|vcomp140d|msvc[pr]1[0-2]0d?|msvc[pr][7-9]\dd?)\.dll$/i;
const PE_EXTENSIONS = new Set([".dll", ".exe", ".node"]);

export const VC_REDIST_DIRECTORY_ENV = "KILO_VC_REDIST_DIR";

export interface VcRuntimeGap {
	readonly binary: string;
	readonly machine: PeMachine | undefined;
	readonly missingDlls: readonly string[];
}

/** Finds a redistributable DLL for a target architecture, or undefined when unavailable. */
export type LocateRedistributableDll = (
	machine: PeMachine,
	dll: string,
) => Promise<string | undefined>;

export function isAbsentFromCleanWindows(dll: string): boolean {
	return REDISTRIBUTABLE_RUNTIME.test(dll) || UNSHIPPABLE_RUNTIME.test(dll);
}

async function listPeCandidates(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) return listPeCandidates(entryPath);
			return entry.isFile() && PE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
				? [entryPath]
				: [];
		}),
	);
	return nested.flat();
}

async function lowercaseEntries(directory: string): Promise<Set<string>> {
	return new Set((await readdir(directory)).map((name) => name.toLowerCase()));
}

/**
 * Lists every packaged binary whose VC++ runtime imports are not satisfied by
 * a DLL in the binary's own directory.
 */
export async function findVcRuntimeGaps(
	root: string,
	readImports: (file: string) => Promise<PeImports | undefined> = readPeImportsFromFile,
): Promise<VcRuntimeGap[]> {
	const gaps: VcRuntimeGap[] = [];
	const siblingsByDirectory = new Map<string, Promise<Set<string>>>();
	for (const binary of await listPeCandidates(root)) {
		const imports = await readImports(binary);
		const runtimeDlls = imports?.dlls.filter(isAbsentFromCleanWindows) ?? [];
		if (runtimeDlls.length === 0) continue;
		const directory = path.dirname(binary);
		let siblings = siblingsByDirectory.get(directory);
		if (!siblings) {
			siblings = lowercaseEntries(directory);
			siblingsByDirectory.set(directory, siblings);
		}
		const present = await siblings;
		const missingDlls = runtimeDlls.filter((dll) => !present.has(dll.toLowerCase()));
		if (missingDlls.length > 0) gaps.push({ binary, machine: imports?.machine, missingDlls });
	}
	return gaps;
}

function describeGaps(root: string, gaps: readonly VcRuntimeGap[]): string {
	return gaps
		.map(
			(gap) =>
				`  ${path.relative(root, gap.binary)} (${gap.machine ?? "unknown machine"}): ${gap.missingDlls.join(", ")}`,
		)
		.join("\n");
}

export async function assertVcRuntimeBundled(root: string): Promise<void> {
	const gaps = await findVcRuntimeGaps(root);
	if (gaps.length === 0) return;
	throw new Error(
		"Packaged Windows binaries import Visual C++ runtime DLLs that are not bundled beside them. " +
			"Clean Windows installs do not have these DLLs, so the binaries fail to load:\n" +
			describeGaps(root, gaps),
	);
}

/**
 * Copies each missing redistributable runtime DLL beside the binary that
 * imports it, then asserts nothing is left unresolved. Repeats because a copied
 * DLL can itself import another runtime DLL (msvcp140 → vcruntime140).
 */
export async function bundleVcRuntime(
	root: string,
	locateDll: LocateRedistributableDll,
): Promise<void> {
	const copiedDestinations = new Set<string>();
	for (;;) {
		let copied = false;
		for (const gap of await findVcRuntimeGaps(root)) {
			if (!gap.machine) continue;
			for (const dll of gap.missingDlls) {
				if (!REDISTRIBUTABLE_RUNTIME.test(dll)) continue;
				const source = await locateDll(gap.machine, dll);
				if (!source) continue;
				const destination = path.join(path.dirname(gap.binary), path.basename(source));
				if (copiedDestinations.has(destination)) continue;
				await copyFile(source, destination);
				copiedDestinations.add(destination);
				copied = true;
			}
		}
		if (!copied) break;
	}
	await assertVcRuntimeBundled(root);
}

const REDIST_ARCH_DIRECTORIES: Record<PeMachine, string> = {
	x86: "x86",
	x64: "x64",
	arm64: "arm64",
};

async function findInRedistArch(
	redistVersionDirectory: string,
	machine: PeMachine,
	dll: string,
): Promise<string | undefined> {
	const archDirectory = path.join(redistVersionDirectory, REDIST_ARCH_DIRECTORIES[machine]);
	let components;
	try {
		components = await readdir(archDirectory, { withFileTypes: true });
	} catch {
		return undefined;
	}
	for (const component of components) {
		if (!component.isDirectory()) continue;
		const componentDirectory = path.join(archDirectory, component.name);
		const match = (await readdir(componentDirectory)).find(
			(name) => name.toLowerCase() === dll.toLowerCase(),
		);
		if (match) return path.join(componentDirectory, match);
	}
	return undefined;
}

export interface VisualStudioRedistOptions {
	readonly env?: NodeJS.ProcessEnv;
	/** Visual Studio installation paths, newest first. */
	readonly listVisualStudioInstallations?: () => Promise<readonly string[]>;
}

async function listVisualStudioInstallationsWithVswhere(env: NodeJS.ProcessEnv): Promise<string[]> {
	const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
	const vswhere = path.win32.join(
		programFilesX86,
		"Microsoft Visual Studio",
		"Installer",
		"vswhere.exe",
	);
	const { stdout } = await execa(vswhere, [
		"-products",
		"*",
		"-sort",
		"-property",
		"installationPath",
	]);
	return stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

async function resolveRedistVersionDirectory(options: VisualStudioRedistOptions): Promise<string> {
	const env = options.env ?? process.env;
	const override = env[VC_REDIST_DIRECTORY_ENV]?.trim();
	if (override) return override;

	const listInstallations =
		options.listVisualStudioInstallations ?? (() => listVisualStudioInstallationsWithVswhere(env));
	let installations: readonly string[];
	try {
		installations = await listInstallations();
	} catch (error) {
		throw new Error(
			`Could not locate Visual Studio with vswhere to bundle the Visual C++ runtime. ` +
				`Install the MSVC build tools or set ${VC_REDIST_DIRECTORY_ENV} to a VC\\Redist\\MSVC\\<version> directory.`,
			{ cause: error },
		);
	}
	for (const installation of installations) {
		try {
			const version = await readFile(
				path.join(
					installation,
					"VC",
					"Auxiliary",
					"Build",
					"Microsoft.VCRedistVersion.default.txt",
				),
				"utf8",
			);
			return path.join(installation, "VC", "Redist", "MSVC", version.trim());
		} catch {
			// Installation without the MSVC redistributable component; try the next one.
		}
	}
	throw new Error(
		`No Visual Studio installation provides the MSVC redistributable. ` +
			`Install the MSVC build tools or set ${VC_REDIST_DIRECTORY_ENV} to a VC\\Redist\\MSVC\\<version> directory.`,
	);
}

/**
 * Locates redistributable DLLs under `VC\Redist\MSVC\<version>\<arch>\*`. The
 * Visual Studio lookup runs once, and only if some binary actually needs a DLL.
 */
export function createVisualStudioRedistLocator(
	options: VisualStudioRedistOptions = {},
): LocateRedistributableDll {
	let redistVersionDirectory: Promise<string> | undefined;
	return async (machine, dll) => {
		redistVersionDirectory ??= resolveRedistVersionDirectory(options);
		return findInRedistArch(await redistVersionDirectory, machine, dll);
	};
}
