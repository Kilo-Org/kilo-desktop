import { describe, expect, it } from "vitest";

import {
	LOCAL_CONDA_FILE_INSTALL_WARNING,
	localCondaFileInstallWarning,
} from "./conda-local-file-warning.js";

describe("localCondaFileInstallWarning", () => {
	it("flags an agent question option that installs a local conda file", () => {
		const label = "From the local .tar.bz2 file";
		const description =
			"Honor the literal request and install /Users/amorais/Downloads/pandas-3.0.6-py314heb7d0cc_0.tar.bz2 " +
			"via the conda CLI (bypasses the Desktop tool's block).";
		expect(localCondaFileInstallWarning(`${label} ${description}`)).toBe(
			LOCAL_CONDA_FILE_INSTALL_WARNING,
		);
	});

	it("does not flag the safe channel option that merely mentions the local file", () => {
		const label = "From channel (Recommended)";
		const description =
			"Install the identical pandas 3.0.6 from the configured channel (conda-forge/main) via the " +
			"supported Desktop tool. No security guardrail bypass. Same package contents as the local file.";
		expect(localCondaFileInstallWarning(`${label} ${description}`)).toBeUndefined();
	});

	it("flags the bash command the fallback runs", () => {
		expect(
			localCondaFileInstallWarning(
				"conda install -p /Users/me/.anaconda/envs/dev /Users/me/Downloads/pandas-3.0.6-py314heb7d0cc_0.tar.bz2",
			),
		).toBe(LOCAL_CONDA_FILE_INSTALL_WARNING);
	});

	it("flags a file:// package spec and mamba/micromamba variants", () => {
		expect(localCondaFileInstallWarning("conda install file:///tmp/pkg-1.0-0.conda")).toBe(
			LOCAL_CONDA_FILE_INSTALL_WARNING,
		);
		expect(localCondaFileInstallWarning("mamba install /tmp/pkg.conda")).toBe(
			LOCAL_CONDA_FILE_INSTALL_WARNING,
		);
		expect(localCondaFileInstallWarning("micromamba install ~/pkg.tar.bz2")).toBe(
			LOCAL_CONDA_FILE_INSTALL_WARNING,
		);
	});

	it("leaves an ordinary channel install alone", () => {
		expect(localCondaFileInstallWarning("conda install numpy python-dateutil")).toBeUndefined();
	});

	it("does not fire on the bare phrase 'local file' without an artifact", () => {
		expect(
			localCondaFileInstallWarning("Install conda packages from the local file"),
		).toBeUndefined();
	});

	it("returns undefined for empty input", () => {
		expect(localCondaFileInstallWarning(undefined)).toBeUndefined();
		expect(localCondaFileInstallWarning("")).toBeUndefined();
	});
});
