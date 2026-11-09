import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import { getAppIdentity } from "./app-identity.js";
import { getReleaseTrack } from "./release.js";
import { assertVcRuntimeBundled } from "./windows-vc-runtime.js";

const desktopRoot = path.resolve(import.meta.dirname, "..");
const makeDirectory = path.join(desktopRoot, "out", "make");
const readyTimeoutMs = 90_000;

interface WindowsAuthenticodeSignature {
	readonly Status: string;
	readonly StatusMessage: string;
	readonly SignerThumbprint?: string | null;
}

const internalPkiTrustError = "terminated in a root certificate which is not trusted";

export function assertWindowsAuthenticodeSignature(signature: WindowsAuthenticodeSignature): void {
	const isValid = signature.Status === "Valid";
	const isTrustedInternalSignature =
		signature.Status === "UnknownError" &&
		Boolean(signature.SignerThumbprint) &&
		signature.StatusMessage.includes(internalPkiTrustError);
	if (!isValid && !isTrustedInternalSignature) {
		throw new Error(
			`Invalid release executable signature: ${signature.Status} ${signature.StatusMessage}`,
		);
	}
}

export function windowsAuthenticodeCheck(executable: string): {
	file: string;
	args: string[];
	env: NodeJS.ProcessEnv;
} {
	return {
		file: "pwsh",
		args: [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"$signature = Get-AuthenticodeSignature -LiteralPath $env:KILO_RELEASE_SMOKE_EXECUTABLE; [PSCustomObject]@{ Status = $signature.Status.ToString(); StatusMessage = $signature.StatusMessage; SignerThumbprint = $signature.SignerCertificate.Thumbprint } | ConvertTo-Json -Compress",
		],
		env: { KILO_RELEASE_SMOKE_EXECUTABLE: executable },
	};
}

async function walkFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map((entry) => {
			const entryPath = path.join(directory, entry.name);
			return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
		}),
	);
	return files.flat();
}

export async function findReleaseUpdateArtifact(
	directory: string,
	platform: NodeJS.Platform,
): Promise<string> {
	const files = await walkFiles(directory);
	const description = platform === "darwin" ? "macOS update ZIP" : "Windows full NuGet package";
	const matches = files.filter((file) =>
		platform === "darwin" ? file.endsWith(".zip") : file.endsWith("-full.nupkg"),
	);
	if (matches.length !== 1) {
		throw new Error(`Expected exactly one ${description}; found ${matches.length}.`);
	}
	return matches[0]!;
}

async function findFile(directory: string, fileName: string): Promise<string> {
	const match = (await walkFiles(directory)).find(
		(file) => path.basename(file).toLowerCase() === fileName.toLowerCase(),
	);
	if (!match) throw new Error(`Could not find ${fileName} in the extracted update payload.`);
	return match;
}

// koffi is a fail-closed native dependency: if its prebuilt @koromix addon is not
// hoisted by `pnpm deploy` and unpacked from app.asar, the packaged main process
// cannot load it and notebook daemon peer authentication silently denies every
// daemon while the app still boots. Nothing else in CI exercises this path, so
// assert the addon physically ships in the packaged tree.
async function assertNativePeerCredentialAddon(resourcesDirectory: string): Promise<void> {
	const unpacked = path.join(resourcesDirectory, "app.asar.unpacked");
	let files: string[];
	try {
		files = await walkFiles(unpacked);
	} catch {
		throw new Error(
			`Packaged app is missing app.asar.unpacked (${unpacked}); koffi's native addon cannot load and notebook peer authentication would deny every daemon.`,
		);
	}
	const addon = files.find(
		(file) =>
			path.basename(file) === "koffi.node" && file.includes(`${path.sep}@koromix${path.sep}`),
	);
	if (!addon) {
		throw new Error(
			"Packaged app is missing koffi's @koromix native addon under app.asar.unpacked; " +
				"notebook daemon peer authentication would fail closed and deny every daemon.",
		);
	}
}

/**
 * The smoke launch boots the shipped binary on a fresh profile, where consent
 * defaults on, so every publish would report a new anonymous production user.
 * Saving the user's opt-out keeps it out of PostHog, Sentry, and subprocess
 * telemetry. Must match PreferencesStore's electron-store file and key
 * (`src/main/platform/PreferencesStore.ts`); a rename silently re-enables it.
 */
export async function seedDataCollectionOptOut(userDataDirectory: string): Promise<void> {
	await mkdir(userDataDirectory, { recursive: true });
	await writeFile(
		path.join(userDataDirectory, "preferences.json"),
		JSON.stringify({ allowDataCollection: false }),
	);
}

async function waitForReadyFile(file: string, child: ReturnType<typeof spawn>): Promise<void> {
	const deadline = Date.now() + readyTimeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`Release app exited before startup completed (exit code ${child.exitCode}).`);
		}
		try {
			await access(file);
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	throw new Error(`Release app did not complete startup within ${readyTimeoutMs / 1000} seconds.`);
}

/**
 * On Windows `child.kill()` terminates only the main Electron process. Its GPU,
 * network, and renderer helpers and the sidecars it spawned keep running with
 * handles open on the extracted payload and user-data directory, which makes the
 * temporary-directory cleanup fail with EPERM/EBUSY. Kill the tree while the
 * parent is still alive, because taskkill cannot find orphaned descendants.
 */
export function windowsProcessTreeKill(pid: number): { file: string; args: string[] } {
	return { file: "taskkill", args: ["/PID", String(pid), "/T", "/F"] };
}

function hasExited(child: ReturnType<typeof spawn>): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

async function terminate(
	child: ReturnType<typeof spawn>,
	platform: NodeJS.Platform,
): Promise<void> {
	if (hasExited(child)) return;
	const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
	if (platform === "win32" && child.pid !== undefined) {
		const treeKill = windowsProcessTreeKill(child.pid);
		await execa(treeKill.file, treeKill.args, { reject: false });
	} else {
		child.kill();
	}
	await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
	if (!hasExited(child)) child.kill("SIGKILL");
}

export async function smokeReleaseArtifact(platform: NodeJS.Platform): Promise<void> {
	if (platform !== "darwin" && platform !== "win32") {
		throw new Error(`Release artifact smoke testing is unsupported on ${platform}.`);
	}

	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kilo-release-smoke-"));
	try {
		const artifact = await findReleaseUpdateArtifact(makeDirectory, platform);
		const extractedDirectory = path.join(temporaryDirectory, "payload");
		const identity = getAppIdentity(getReleaseTrack(process.env));
		let executable: string;

		if (platform === "darwin") {
			await execa("ditto", ["-x", "-k", artifact, extractedDirectory]);
			const appBundle = path.join(extractedDirectory, `${identity.productName}.app`);
			await execa("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appBundle]);
			await execa("spctl", ["--assess", "--type", "execute", "--verbose=4", appBundle]);
			await execa("xcrun", ["stapler", "validate", appBundle]);
			await assertNativePeerCredentialAddon(path.join(appBundle, "Contents", "Resources"));
			executable = path.join(appBundle, "Contents", "MacOS", identity.productName);
		} else {
			await mkdir(extractedDirectory);
			await execa("tar", ["-xf", artifact, "-C", extractedDirectory]);
			executable = await findFile(extractedDirectory, `${identity.executableName}.exe`);
			const authenticode = windowsAuthenticodeCheck(executable);
			const { stdout } = await execa(authenticode.file, authenticode.args, {
				env: authenticode.env,
			});
			assertWindowsAuthenticodeSignature(JSON.parse(stdout) as WindowsAuthenticodeSignature);
			await assertNativePeerCredentialAddon(path.join(path.dirname(executable), "resources"));
			// The runner has the VC++ Redistributable in System32, so booting the
			// app below cannot detect a binary that depends on it.
			await assertVcRuntimeBundled(path.dirname(executable));
		}

		const readyFile = path.join(temporaryDirectory, "ready");
		const userDataDirectory = path.join(temporaryDirectory, "user-data");
		await seedDataCollectionOptOut(userDataDirectory);
		const child = spawn(executable, [`--user-data-dir=${userDataDirectory}`], {
			env: {
				...process.env,
				CI: "true",
				KILO_RELEASE_SMOKE_READY_FILE: readyFile,
				KILO_SKIP_ONBOARDING: "1",
				ANACONDA_SKIP_KEYRING: "1",
			},
			stdio: "inherit",
		});

		try {
			await waitForReadyFile(readyFile, child);
		} finally {
			await terminate(child, platform);
		}
	} finally {
		// Windows releases image and file handles asynchronously after a process
		// exits; rm retries EBUSY/EPERM with linear backoff (~27s worst case).
		await rm(temporaryDirectory, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 500,
		});
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await smokeReleaseArtifact(process.platform);
}
