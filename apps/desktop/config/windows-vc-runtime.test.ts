import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildPeImage, PE_MACHINE, type PeImageOptions } from "./test-fixtures/windows-pe.js";
import {
	assertVcRuntimeBundled,
	bundleVcRuntime,
	createVisualStudioRedistLocator,
	findVcRuntimeGaps,
	isAbsentFromCleanWindows,
	VC_REDIST_DIRECTORY_ENV,
} from "./windows-vc-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
	);
});

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-vc-runtime-"));
	temporaryDirectories.push(directory);
	return directory;
}

async function writePe(file: string, options: PeImageOptions): Promise<string> {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, buildPeImage(options));
	return file;
}

/** Lays out `VC\Redist\MSVC\<version>\<arch>\Microsoft.VC143.CRT` like a Visual Studio install. */
async function fakeRedist(root: string, arch: string, dlls: Record<string, PeImageOptions>) {
	const crt = path.join(root, arch, "Microsoft.VC143.CRT");
	await mkdir(path.join(root, arch, "Microsoft.VC143.OpenMP"), { recursive: true });
	for (const [dll, options] of Object.entries(dlls)) {
		await writePe(path.join(crt, dll), options);
	}
	return crt;
}

describe("clean-Windows runtime classification", () => {
	it.each([
		"VCRUNTIME140.dll",
		"vcruntime140_1.dll",
		"MSVCP140.dll",
		"ucrtbased.dll",
		"MSVCR120.dll",
	])("treats %s as absent from a clean install", (dll) => {
		expect(isAbsentFromCleanWindows(dll)).toBe(true);
	});

	it.each(["KERNEL32.dll", "msvcrt.dll", "api-ms-win-crt-runtime-l1-1-0.dll", "ucrtbase.dll"])(
		"treats OS-provided %s as present",
		(dll) => {
			expect(isAbsentFromCleanWindows(dll)).toBe(false);
		},
	);
});

describe("VC++ runtime audit", () => {
	it("flags only binaries whose runtime imports are not beside them", async () => {
		const payload = await temporaryDirectory();
		const addon = await writePe(path.join(payload, "resources", "addon", "binding.node"), {
			imports: ["KERNEL32.dll", "VCRUNTIME140.dll"],
		});
		await writePe(path.join(payload, "resources", "daemon", "daemon.exe"), {
			imports: ["VCRUNTIME140.dll"],
		});
		await writePe(path.join(payload, "resources", "daemon", "VCRuntime140.DLL"), {
			imports: ["KERNEL32.dll"],
		});
		await writePe(path.join(payload, "Kilo.exe"), { imports: ["KERNEL32.dll"] });
		await writeFile(path.join(payload, "resources", "app.asar"), "not a PE image");

		await expect(findVcRuntimeGaps(payload)).resolves.toEqual([
			{ binary: addon, machine: "x64", missingDlls: ["VCRUNTIME140.dll"] },
		]);
	});

	it("names each unsatisfied binary relative to the payload", async () => {
		const payload = await temporaryDirectory();
		await writePe(path.join(payload, "resources", "binding.node"), {
			machine: PE_MACHINE.arm64,
			imports: ["VCRUNTIME140.dll"],
		});

		await expect(assertVcRuntimeBundled(payload)).rejects.toThrow(
			`${path.join("resources", "binding.node")} (arm64): VCRUNTIME140.dll`,
		);
	});

	it("passes a payload with no runtime dependencies", async () => {
		const payload = await temporaryDirectory();
		await writePe(path.join(payload, "Kilo.exe"), { imports: ["KERNEL32.dll"] });

		await expect(assertVcRuntimeBundled(payload)).resolves.toBeUndefined();
	});
});

describe("VC++ runtime bundling", () => {
	it("copies the matching-architecture runtime beside each binary that needs it", async () => {
		const workspace = await temporaryDirectory();
		const payload = path.join(workspace, "payload");
		const redist = path.join(workspace, "redist", "14.44.35112");
		await fakeRedist(redist, "x64", { "vcruntime140.dll": { imports: ["KERNEL32.dll"] } });
		await fakeRedist(redist, "arm64", {
			"vcruntime140.dll": { machine: PE_MACHINE.arm64, imports: ["KERNEL32.dll"] },
		});
		await writePe(path.join(payload, "x64", "binding.node"), { imports: ["VCRUNTIME140.dll"] });
		await writePe(path.join(payload, "arm64", "binding.node"), {
			machine: PE_MACHINE.arm64,
			imports: ["VCRUNTIME140.dll"],
		});

		await bundleVcRuntime(
			payload,
			createVisualStudioRedistLocator({ env: { [VC_REDIST_DIRECTORY_ENV]: redist } }),
		);

		await expect(readdir(path.join(payload, "x64"))).resolves.toContain("vcruntime140.dll");
		await expect(findVcRuntimeGaps(payload)).resolves.toEqual([]);
	});

	it("also bundles the runtime DLLs that a bundled DLL depends on", async () => {
		const workspace = await temporaryDirectory();
		const payload = path.join(workspace, "payload");
		const redist = path.join(workspace, "redist");
		await fakeRedist(redist, "x64", {
			"msvcp140.dll": { imports: ["VCRUNTIME140.dll", "vcruntime140_1.dll"] },
			"vcruntime140.dll": { imports: ["KERNEL32.dll"] },
			"vcruntime140_1.dll": { imports: ["VCRUNTIME140.dll"] },
		});
		await writePe(path.join(payload, "tool.exe"), { imports: ["MSVCP140.dll"] });

		await bundleVcRuntime(
			payload,
			createVisualStudioRedistLocator({ env: { [VC_REDIST_DIRECTORY_ENV]: redist } }),
		);

		expect((await readdir(payload)).sort()).toEqual([
			"msvcp140.dll",
			"tool.exe",
			"vcruntime140.dll",
			"vcruntime140_1.dll",
		]);
	});

	it("fails when a needed runtime cannot be shipped", async () => {
		const payload = await temporaryDirectory();
		await writePe(path.join(payload, "debug.node"), { imports: ["ucrtbased.dll"] });
		await writePe(path.join(payload, "unknown.node"), {
			machine: PE_MACHINE.arm,
			imports: ["VCRUNTIME140.dll"],
		});
		await writePe(path.join(payload, "missing", "binding.node"), { imports: ["VCRUNTIME140.dll"] });

		const bundling = bundleVcRuntime(payload, async () => undefined);

		await expect(bundling).rejects.toThrow("debug.node (x64): ucrtbased.dll");
		await expect(bundling).rejects.toThrow("unknown.node (unknown machine): VCRUNTIME140.dll");
		await expect(bundling).rejects.toThrow(
			`${path.join("missing", "binding.node")} (x64): VCRUNTIME140.dll`,
		);
	});
});

describe("Visual Studio redistributable lookup", () => {
	async function fakeVisualStudio(installation: string, version: string): Promise<void> {
		const build = path.join(installation, "VC", "Auxiliary", "Build");
		await mkdir(build, { recursive: true });
		await writeFile(path.join(build, "Microsoft.VCRedistVersion.default.txt"), `${version}\r\n`);
		await fakeRedist(path.join(installation, "VC", "Redist", "MSVC", version), "x64", {
			"vcruntime140.dll": {},
		});
	}

	it("uses the default redistributable of the newest installation that has one", async () => {
		const root = await temporaryDirectory();
		const withoutMsvc = path.join(root, "BuildTools");
		const community = path.join(root, "Community");
		await mkdir(withoutMsvc);
		await fakeVisualStudio(community, "14.44.35112");
		const locate = createVisualStudioRedistLocator({
			env: {},
			listVisualStudioInstallations: async () => [withoutMsvc, community],
		});

		await expect(locate("x64", "VCRUNTIME140.dll")).resolves.toBe(
			path.join(
				community,
				"VC",
				"Redist",
				"MSVC",
				"14.44.35112",
				"x64",
				"Microsoft.VC143.CRT",
				"vcruntime140.dll",
			),
		);
		await expect(locate("arm64", "vcruntime140.dll")).resolves.toBeUndefined();
		await expect(locate("x64", "vcomp140.dll")).resolves.toBeUndefined();
	});

	it("explains how to proceed when no installation provides the redistributable", async () => {
		const locate = createVisualStudioRedistLocator({
			env: {},
			listVisualStudioInstallations: async () => [],
		});

		await expect(locate("x64", "vcruntime140.dll")).rejects.toThrow(VC_REDIST_DIRECTORY_ENV);
	});

	it("explains how to proceed when Visual Studio cannot be queried", async () => {
		const locate = createVisualStudioRedistLocator({
			env: {},
			listVisualStudioInstallations: async () => {
				throw new Error("spawn vswhere.exe ENOENT");
			},
		});

		await expect(locate("x64", "vcruntime140.dll")).rejects.toThrow(
			"Could not locate Visual Studio with vswhere",
		);
	});
});
