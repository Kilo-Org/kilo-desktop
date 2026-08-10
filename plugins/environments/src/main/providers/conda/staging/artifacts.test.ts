import { describe, expect, it } from "vitest";

import { getMinicondaInstaller, MINICONDA_ARTIFACTS } from "./artifacts.js";

describe("artifacts", () => {
	it("returns the darwin-arm64 artifact", () => {
		const artifact = getMinicondaInstaller("darwin", "arm64");
		expect(artifact.target).toBe("darwin-arm64");
		expect(artifact.condaBinRelPath).toBe("bin/conda");
		expect(artifact.installerUrl).toContain("MacOSX-arm64");
	});

	it("returns the linux-x64 artifact", () => {
		const artifact = getMinicondaInstaller("linux", "x64");
		expect(artifact.target).toBe("linux-x64");
		expect(artifact.condaBinRelPath).toBe("bin/conda");
		expect(artifact.installerUrl).toContain("Linux-x86_64");
	});

	it("returns the win32-x64 artifact", () => {
		const artifact = getMinicondaInstaller("win32", "x64");
		expect(artifact.target).toBe("win32-x64");
		expect(artifact.condaBinRelPath).toBe("Scripts\\conda.exe");
		expect(artifact.installerUrl).toContain("Windows-x86_64");
	});

	it("throws for unsupported platform/arch", () => {
		expect(() => getMinicondaInstaller("freebsd", "arm64")).toThrow(
			"Miniconda installer not configured for freebsd/arm64.",
		);
	});

	it("contains exactly 3 artifacts covering all supported targets", () => {
		expect(MINICONDA_ARTIFACTS).toHaveLength(3);
		const targets = MINICONDA_ARTIFACTS.map((a) => a.target);
		expect(targets).toEqual(["darwin-arm64", "linux-x64", "win32-x64"]);
	});
});
