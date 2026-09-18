import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import { getAppIdentity } from "./app-identity.js";
import { getReleaseTrack } from "./release.js";

const desktopRoot = path.resolve(import.meta.dirname, "..");
const makeDirectory = path.join(desktopRoot, "out", "make");
const readyTimeoutMs = 90_000;

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

async function terminate(child: ReturnType<typeof spawn>): Promise<void> {
	if (child.exitCode !== null) return;
	child.kill();
	await Promise.race([
		new Promise<void>((resolve) => child.once("exit", () => resolve())),
		new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
	]);
	if (child.exitCode === null) child.kill("SIGKILL");
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
			executable = path.join(appBundle, "Contents", "MacOS", identity.productName);
		} else {
			await mkdir(extractedDirectory);
			await execa("tar", ["-xf", artifact, "-C", extractedDirectory]);
			executable = await findFile(extractedDirectory, `${identity.executableName}.exe`);
			await execa(
				"powershell.exe",
				[
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					'$signature = Get-AuthenticodeSignature -LiteralPath $env:KILO_RELEASE_SMOKE_EXECUTABLE; if ($signature.Status -ne "Valid") { throw "Invalid release executable signature: $($signature.Status)" }',
				],
				{ env: { KILO_RELEASE_SMOKE_EXECUTABLE: executable } },
			);
		}

		const readyFile = path.join(temporaryDirectory, "ready");
		const userDataDirectory = path.join(temporaryDirectory, "user-data");
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
			await terminate(child);
		}
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await smokeReleaseArtifact(process.platform);
}
