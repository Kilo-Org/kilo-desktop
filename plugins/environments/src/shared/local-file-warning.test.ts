import { describe, expect, it } from "vitest";

import {
	LOCAL_CONDA_FILE_INSTALL_WARNING,
	localCondaFileInstallWarning,
} from "./local-file-warning.js";

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

	it.each([
		"pip install ./dist/foo-1.0-py3-none-any.whl",
		"pip3 install /Users/me/Downloads/foo-1.0.tar.gz",
		"pip install ~/Downloads/foo-1.0-py3-none-any.whl",
		"pip install foo-1.0-py3-none-any.whl",
		"conda run -n dev pip install file:///Users/me/foo-1.0-py3-none-any.whl",
		"micromamba run -n env uv pip install file:///tmp/foo.whl",
		"python -m pip install --no-index --find-links ./wheels foo",
		"pip install --find-links=/tmp/wheels foo",
		"pip install \\\n  ./dist/foo-1.0-py3-none-any.whl",
	])("flags a pip install of a local package file: %s", (command) => {
		expect(localCondaFileInstallWarning(command)).toBe(LOCAL_CONDA_FILE_INSTALL_WARNING);
	});

	it.each([
		"pip install numpy",
		'pip install -U "pandas[performance]>=2.2" python-dateutil',
		"conda run -n dev python -m pip install requests==2.32.3",
		"pip install https://files.example.com/foo-1.0-py3-none-any.whl",
		'pip install "foo @ git+https://github.com/org/foo.git"',
		"pip install --find-links https://download.pytorch.org/whl/torch_stable.html torch",
	])("does not flag a pip install by package name or remote URL: %s", (command) => {
		expect(localCondaFileInstallWarning(command)).toBeUndefined();
	});

	it.each([
		"pip install -e .",
		'pip install -e ".[dev,test]"',
		"pip install .",
		"pip install --editable=./src/pkg",
		"pip install ../sibling-project",
	])("does not flag setting up a project from its source directory: %s", (command) => {
		expect(localCondaFileInstallWarning(command)).toBeUndefined();
	});

	it.each([
		"cd /Users/me/project && pip install numpy",
		"pip install -r ./requirements.txt -c ./constraints.txt",
		"pip install --target ./vendor --requirement=./requirements.txt requests",
		"pip install numpy > /tmp/pip.log 2>/dev/null",
		"pip install numpy  # foo-1.0-py3-none-any.whl is cached in /tmp/wheels",
	])("ignores paths that are not the pip package source: %s", (command) => {
		expect(localCondaFileInstallWarning(command)).toBeUndefined();
	});

	it.each([
		"test -x /Users/me/project/.conda/bin/python",
		"/Users/me/project/.conda/bin/python --version",
		"~/.conda/envs/dev/bin/python --version",
		'test -x "/Users/me/.conda/envs/agent-security/bin/python"',
		'"/Users/me/.conda/envs/agent-security/bin/python" --version',
		"ls ~/Downloads/pandas-3.0.6-py314heb7d0cc_0.conda",
	])("does not flag a command that installs nothing: %s", (command) => {
		expect(localCondaFileInstallWarning(command)).toBeUndefined();
	});

	it.each([
		"conda install -p /Users/me/project/.conda numpy",
		"conda install -p .conda numpy",
		"cd ~/.conda && conda install numpy",
		"conda run -p ~/.conda/envs/dev pip install numpy",
		"/Users/me/project/.conda/bin/pip install pandas",
	])("does not mistake a .conda environment directory for a package file: %s", (command) => {
		expect(localCondaFileInstallWarning(command)).toBeUndefined();
	});

	it.each([
		String.raw`pip install C:\Users\me\Downloads\foo-1.0-py3-none-any.whl`,
		String.raw`py -m pip install .\dist\foo-1.0.zip`,
		String.raw`pip.exe install "%USERPROFILE%\My Downloads\foo-1.0.tar.gz"`,
		String.raw`& "C:\Program Files\Python312\Scripts\pip.exe" install $env:USERPROFILE\Downloads\foo.whl`,
		String.raw`pip install \\fileserver\share\wheels\foo-1.0-py3-none-any.whl`,
		"pip install file:///C:/Users/me/foo-1.0-py3-none-any.whl",
		"pip install --no-deps `\n  C:\\dist\\foo-1.0-py3-none-any.whl",
		"pip install --no-deps ^\n  C:\\dist\\foo-1.0-py3-none-any.whl",
		String.raw`conda.exe install C:\Users\me\Downloads\pandas-3.0.6-py314heb7d0cc_0.tar.bz2`,
		String.raw`mamba install "%USERPROFILE%\Downloads\pkg-1.0-0.conda"`,
	])("flags a Windows local package file install: %s", (command) => {
		expect(localCondaFileInstallWarning(command)).toBe(LOCAL_CONDA_FILE_INSTALL_WARNING);
	});

	it.each([
		String.raw`pip install -e C:\Users\me\projects\app`,
		String.raw`pip install -r C:\project\requirements.txt *> $null`,
		String.raw`cd C:\Users\me\project; pip install numpy`,
		String.raw`& "C:\Program Files\Python312\Scripts\pip.exe" install numpy`,
		String.raw`C:\Users\me\project\.conda\python.exe --version`,
		String.raw`C:\Users\me\project\.conda\python.exe -m pip install pandas`,
		String.raw`conda install -p C:\Users\me\project\.conda numpy`,
	])("does not flag a Windows command that installs no local package file: %s", (command) => {
		expect(localCondaFileInstallWarning(command)).toBeUndefined();
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
