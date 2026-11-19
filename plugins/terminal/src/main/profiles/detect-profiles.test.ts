// Ported from VS Code's src/vs/workbench/contrib/terminal/test/node/terminalProfiles.test.ts,
// with the platform injected so the Windows cases run everywhere, plus cases
// replacing its machine-dependent PowerShell finder test.
import { describe, expect, it, vi } from "vitest";

import type { CustomTerminalProfile, TerminalProfile } from "../../contracts/profiles";
import { detectProfiles, loginShellsOf, type DetectDeps, type DetectFs } from "./detect-profiles";

interface FsOptions {
	readonly etcShells?: string;
	/** Files that exist but cannot be launched. */
	readonly nonExecutable?: readonly string[];
	/** Directories whose listing fails with EACCES. */
	readonly unreadable?: readonly string[];
}

function createFsProvider(files: readonly string[], options: FsOptions = {}): DetectFs {
	const everything = [...files, ...(options.nonExecutable ?? [])];
	const under = (directory: string) =>
		everything.filter(
			(file) => file.startsWith(`${directory}\\`) || file.startsWith(`${directory}/`),
		);
	return {
		isExecutableFile: async (path) =>
			files.includes(path) && !(options.nonExecutable ?? []).includes(path),
		isDirectory: async (path) => under(path).length > 0,
		readdir: async (path) => {
			if (options.unreadable?.includes(path)) {
				throw Object.assign(new Error(`EACCES: ${path}`), { code: "EACCES" });
			}
			return [
				...new Set(under(path).map((file) => file.slice(path.length + 1).split(/[\\/]/)[0]!)),
			];
		},
		readFile: async (path) => {
			if (path === "/etc/shells" && options.etcShells !== undefined) return options.etcShells;
			throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
		},
	};
}

const noWsl = vi.fn(async () => {
	throw new Error("wsl.exe not installed");
});

function windowsDeps(files: readonly string[], overrides: Partial<DetectDeps> = {}): DetectDeps {
	return {
		platform: "win32",
		env: {
			windir: "C:\\Windows",
			ProgramFiles: "C:\\Program Files",
			PATHEXT: ".COM;.EXE;.BAT;.CMD",
			Path: "C:\\Windows\\System32",
		},
		fs: createFsProvider(files),
		execFile: noWsl,
		arch: "x64",
		homedir: "C:\\Users\\me",
		cwd: "C:\\Users\\me",
		windowsBuild: 22631,
		loginShells: [],
		...overrides,
	};
}

function unixDeps(fs: DetectFs, overrides: Partial<DetectDeps> = {}): DetectDeps {
	return {
		platform: "darwin",
		env: { PATH: "/usr/bin:/bin" },
		fs,
		execFile: noWsl,
		arch: "arm64",
		homedir: "/Users/me",
		cwd: "/Users/me",
		loginShells: [],
		...overrides,
	};
}

/** The parts of profiles these tests care about, in label order (VS Code's `profilesEqual` ignores order). */
function summary(profiles: readonly TerminalProfile[]) {
	return profiles
		.map(({ label, path, args }) => ({ label, path, args }))
		.toSorted((a, b) => a.label.localeCompare(b.label));
}

const custom = (
	profile: Omit<CustomTerminalProfile, "id"> & { id?: string },
): CustomTerminalProfile => ({
	id: profile.id ?? profile.label,
	...profile,
});

const WINDOWS_POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const PWSH_7 = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const pwshOnly = {
	includeDetected: false,
	customProfiles: [custom({ label: "PowerShell", source: "pwsh" })],
};

describe("detectProfiles on Windows", () => {
	it("detects Git Bash and gives it login args", async () => {
		const profiles = await detectProfiles(
			windowsDeps(["C:\\Program Files\\Git\\bin\\bash.exe"], {
				includeDetected: false,
				customProfiles: [custom({ label: "Git Bash", source: "git-bash" })],
			}),
		);
		expect(summary(profiles)).toEqual([
			{ label: "Git Bash", path: "C:\\Program Files\\Git\\bin\\bash.exe", args: ["--login", "-i"] },
		]);
	});

	it("lets a source carry its own args", async () => {
		const profiles = await detectProfiles(
			windowsDeps([PWSH_7], {
				includeDetected: false,
				customProfiles: [custom({ label: "PowerShell", source: "pwsh", args: ["-NoProfile"] })],
			}),
		);
		expect(summary(profiles)).toEqual([
			{ label: "PowerShell", path: PWSH_7, args: ["-NoProfile"] },
		]);
	});

	it("lets configured args override a source's default ones", async () => {
		const profiles = await detectProfiles(
			windowsDeps(["C:\\Program Files\\Git\\bin\\bash.exe"], {
				includeDetected: false,
				customProfiles: [custom({ label: "Git Bash", source: "git-bash", args: [] })],
			}),
		);
		expect(summary(profiles)).toEqual([
			{ label: "Git Bash", path: "C:\\Program Files\\Git\\bin\\bash.exe", args: [] },
		]);
	});

	it("finds Git Bash beside git.exe on PATH", async () => {
		const profiles = await detectProfiles(
			windowsDeps(["C:\\Tools\\Git\\cmd\\git.exe", "C:\\Tools\\Git\\bin\\bash.exe"], {
				env: { windir: "C:\\Windows", PATHEXT: ".EXE", Path: "C:\\Tools\\Git\\cmd" },
				includeDetected: false,
				customProfiles: [custom({ label: "Git Bash", source: "git-bash" })],
			}),
		);
		expect(summary(profiles)[0]?.path).toBe("C:\\Tools\\Git\\bin\\bash.exe");
	});

	describe("pwsh source detection and fallback", () => {
		it("prefers pwsh 7 to Windows PowerShell", async () => {
			const profiles = await detectProfiles(windowsDeps([PWSH_7, WINDOWS_POWERSHELL], pwshOnly));
			expect(summary(profiles)).toEqual([{ label: "PowerShell", path: PWSH_7, args: [] }]);
		});

		it("prefers pwsh 7 to pwsh 6", async () => {
			const profiles = await detectProfiles(
				windowsDeps(
					["C:\\Program Files\\PowerShell\\6\\pwsh.exe", PWSH_7, WINDOWS_POWERSHELL],
					pwshOnly,
				),
			);
			expect(summary(profiles)).toEqual([{ label: "PowerShell", path: PWSH_7, args: [] }]);
		});

		it("falls back to Windows PowerShell", async () => {
			const profiles = await detectProfiles(windowsDeps([WINDOWS_POWERSHELL], pwshOnly));
			expect(summary(profiles)).toEqual([
				{ label: "PowerShell", path: WINDOWS_POWERSHELL, args: [] },
			]);
		});

		it("picks a preview build only when no stable install exists", async () => {
			const preview = "C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe";
			expect(
				summary(await detectProfiles(windowsDeps([preview, WINDOWS_POWERSHELL], pwshOnly)))[0]
					?.path,
			).toBe(preview);
			expect(
				summary(
					await detectProfiles(windowsDeps([preview, PWSH_7, WINDOWS_POWERSHELL], pwshOnly)),
				)[0]?.path,
			).toBe(PWSH_7);
		});

		it("finds a 32-bit install from a 64-bit process", async () => {
			const x86 = "C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe";
			const profiles = await detectProfiles(
				windowsDeps([x86, WINDOWS_POWERSHELL], {
					...pwshOnly,
					env: {
						windir: "C:\\Windows",
						ProgramFiles: "C:\\Program Files",
						"ProgramFiles(x86)": "C:\\Program Files (x86)",
					},
				}),
			);
			expect(summary(profiles)[0]?.path).toBe(x86);
		});

		it("finds a 64-bit install from a 32-bit process", async () => {
			const x64 = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
			const profiles = await detectProfiles(
				windowsDeps([x64, "C:\\Windows\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe"], {
					...pwshOnly,
					arch: "ia32",
					env: {
						windir: "C:\\Windows",
						ProgramFiles: "C:\\Program Files (x86)",
						ProgramW6432: "C:\\Program Files",
						PROCESSOR_ARCHITECTURE: "X86",
						PROCESSOR_ARCHITEW6432: "AMD64",
					},
				}),
			);
			expect(summary(profiles)[0]?.path).toBe(x64);
		});

		it("finds the Microsoft Store install", async () => {
			const msix =
				"C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\Microsoft.PowerShell_8wekyb3d8bbwe\\pwsh.exe";
			const profiles = await detectProfiles(
				windowsDeps([msix, WINDOWS_POWERSHELL], {
					...pwshOnly,
					env: { windir: "C:\\Windows", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
				}),
			);
			expect(summary(profiles)[0]?.path).toBe(msix);
		});

		it("finds the .NET global tool before a preview build", async () => {
			const tool = "C:\\Users\\me\\.dotnet\\tools\\pwsh.exe";
			const preview = "C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe";
			const profiles = await detectProfiles(
				windowsDeps([preview, tool, WINDOWS_POWERSHELL], pwshOnly),
			);
			expect(summary(profiles)[0]?.path).toBe(tool);
		});

		it("finds a Scoop install before Windows PowerShell, which is always last", async () => {
			const scoop = "C:\\Users\\me\\scoop\\apps\\pwsh\\current\\pwsh.exe";
			const profiles = await detectProfiles(windowsDeps([WINDOWS_POWERSHELL, scoop], pwshOnly));
			expect(summary(profiles)[0]?.path).toBe(scoop);
		});

		it("still finds other shells when Program Files can't be listed", async () => {
			const profiles = await detectProfiles(
				windowsDeps([PWSH_7, WINDOWS_POWERSHELL, "C:\\Windows\\System32\\cmd.exe"], {
					fs: createFsProvider([PWSH_7, WINDOWS_POWERSHELL, "C:\\Windows\\System32\\cmd.exe"], {
						unreadable: ["C:\\Program Files\\PowerShell"],
					}),
				}),
			);
			expect(summary(profiles)).toEqual([
				{ label: "Command Prompt", path: "C:\\Windows\\System32\\cmd.exe", args: [] },
				{ label: "PowerShell", path: WINDOWS_POWERSHELL, args: [] },
				{ label: "Windows PowerShell", path: WINDOWS_POWERSHELL, args: [] },
			]);
		});
	});

	it("finds Command Prompt and Windows PowerShell at their fixed paths", async () => {
		const profiles = await detectProfiles(
			windowsDeps(["C:\\Windows\\System32\\cmd.exe", WINDOWS_POWERSHELL]),
		);
		expect(summary(profiles)).toEqual([
			{ label: "Command Prompt", path: "C:\\Windows\\System32\\cmd.exe", args: [] },
			{ label: "PowerShell", path: WINDOWS_POWERSHELL, args: [] },
			{ label: "Windows PowerShell", path: WINDOWS_POWERSHELL, args: [] },
		]);
		expect(profiles.map((profile) => profile.id).toSorted()).toEqual([
			"detected:command-prompt",
			"detected:powershell",
			"detected:windows-powershell",
		]);
	});

	it("uses Sysnative from a 32-bit process on 64-bit Windows", async () => {
		const cmd = "C:\\Windows\\Sysnative\\cmd.exe";
		const winPs = "C:\\Windows\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe";
		const profiles = await detectProfiles(
			windowsDeps([cmd, winPs], {
				arch: "ia32",
				env: {
					windir: "C:\\Windows",
					PROCESSOR_ARCHITECTURE: "X86",
					PROCESSOR_ARCHITEW6432: "AMD64",
				},
			}),
		);
		expect(summary(profiles)).toEqual([
			{ label: "Command Prompt", path: cmd, args: [] },
			{ label: "PowerShell", path: winPs, args: [] },
			{ label: "Windows PowerShell", path: winPs, args: [] },
		]);
	});

	describe("PATH resolution", () => {
		it("applies PATHEXT to a bare name", async () => {
			const profiles = await detectProfiles(
				windowsDeps([PWSH_7], {
					env: {
						windir: "C:\\Windows",
						PATHEXT: ".COM;.EXE",
						Path: "C:\\Program Files\\PowerShell\\7",
					},
					includeDetected: false,
					customProfiles: [custom({ id: "mine", label: "Mine", path: "pwsh" })],
				}),
			);
			expect(summary(profiles)).toEqual([{ label: "Mine", path: PWSH_7, args: [] }]);
			expect(profiles[0]?.id).toBe("mine");
			expect(profiles[0]?.source).toBe("custom");
		});

		it("searches the last PATH entry", async () => {
			const profiles = await detectProfiles(
				windowsDeps(["C:\\last\\nu.exe"], {
					env: { windir: "C:\\Windows", Path: "C:\\first;C:\\second;C:\\last" },
					includeDetected: false,
					customProfiles: [custom({ label: "Nu", path: "nu.exe" })],
				}),
			);
			expect(summary(profiles)[0]?.path).toBe("C:\\last\\nu.exe");
		});
	});

	describe("WSL", () => {
		const wslOutput = Buffer.from(
			"Ubuntu-22.04\r\ndocker-desktop\r\ndocker-desktop-data\r\nDebian\r\n",
			"utf16le",
		);

		it("adds one profile per distro, skipping Docker's", async () => {
			const execFile = vi.fn(async () => wslOutput);
			const profiles = await detectProfiles(
				windowsDeps(["C:\\Windows\\System32\\cmd.exe"], { execFile }),
			);
			expect(summary(profiles)).toEqual([
				{ label: "Command Prompt", path: "C:\\Windows\\System32\\cmd.exe", args: [] },
				{ label: "Debian (WSL)", path: "C:\\Windows\\System32\\wsl.exe", args: ["-d", "Debian"] },
				{
					label: "Ubuntu-22.04 (WSL)",
					path: "C:\\Windows\\System32\\wsl.exe",
					args: ["-d", "Ubuntu-22.04"],
				},
			]);
			expect(execFile).toHaveBeenCalledWith(
				"C:\\Windows\\System32\\wsl.exe",
				["-l", "-q"],
				expect.objectContaining({
					timeout: 1_000,
					env: expect.objectContaining({ WSL_UTF8: "0" }),
				}),
			);
		});

		it("never asks before build 19041", async () => {
			const execFile = vi.fn(async () => wslOutput);
			await detectProfiles(windowsDeps([], { execFile, windowsBuild: 18363 }));
			await detectProfiles(windowsDeps([], { execFile, windowsBuild: undefined }));
			expect(execFile).not.toHaveBeenCalled();
		});

		it("keeps the other profiles when wsl.exe fails", async () => {
			const profiles = await detectProfiles(windowsDeps(["C:\\Windows\\System32\\cmd.exe"]));
			expect(summary(profiles)).toEqual([
				{ label: "Command Prompt", path: "C:\\Windows\\System32\\cmd.exe", args: [] },
			]);
		});
	});
});

describe("detectProfiles on macOS and Linux", () => {
	const fakeshells = (path: (name: string) => string) =>
		["fakeshell1", "fakeshell2", "fakeshell3"].map((name) =>
			custom({ label: name, path: path(name) }),
		);

	it("detects shells via absolute paths", async () => {
		const profiles = await detectProfiles(
			unixDeps(createFsProvider(["/bin/fakeshell1", "/bin/fakeshell3"]), {
				includeDetected: false,
				customProfiles: fakeshells((name) => `/bin/${name}`),
			}),
		);
		expect(summary(profiles)).toEqual([
			{ label: "fakeshell1", path: "/bin/fakeshell1", args: [] },
			{ label: "fakeshell3", path: "/bin/fakeshell3", args: [] },
		]);
	});

	it("auto detects shells via /etc/shells", async () => {
		const profiles = await detectProfiles(
			unixDeps(
				createFsProvider(["/bin/fakeshell1", "/bin/fakeshell3"], {
					etcShells: "/bin/fakeshell1\n/bin/fakeshell3",
				}),
				{ customProfiles: fakeshells((name) => name) },
			),
		);
		expect(summary(profiles)).toEqual([
			{ label: "fakeshell1", path: "/bin/fakeshell1", args: [] },
			{ label: "fakeshell3", path: "/bin/fakeshell3", args: [] },
		]);
	});

	it("validates that shells from /etc/shells exist", async () => {
		const profiles = await detectProfiles(
			unixDeps(
				createFsProvider(["/bin/fakeshell1"], { etcShells: "/bin/fakeshell1\n/bin/fakeshell3" }),
				{
					customProfiles: fakeshells((name) => name),
				},
			),
		);
		expect(summary(profiles)).toEqual([{ label: "fakeshell1", path: "/bin/fakeshell1", args: [] }]);
	});

	it("strips comments from /etc/shells and numbers duplicate names", async () => {
		const profiles = await detectProfiles(
			unixDeps(
				createFsProvider(["/bin/bash", "/bin/zsh", "/usr/local/bin/bash", "/opt/bash"], {
					etcShells:
						"# List of acceptable shells\n/bin/bash\n/bin/zsh # default\n\n/usr/local/bin/bash\n/opt/bash\n/bin/missing\n",
				}),
			),
		);
		expect(summary(profiles)).toEqual([
			{ label: "bash", path: "/bin/bash", args: [] },
			{ label: "bash (2)", path: "/usr/local/bin/bash", args: [] },
			{ label: "bash (3)", path: "/opt/bash", args: [] },
			{ label: "zsh", path: "/bin/zsh", args: [] },
		]);
		expect(profiles.find((profile) => profile.label === "bash (2)")?.id).toBe("detected:bash-2");
		expect(profiles.every((profile) => profile.source === "detected" && profile.available)).toBe(
			true,
		);
	});

	it("finds a bare-name profile at the login shell path when it is not on PATH", async () => {
		const profiles = await detectProfiles(
			unixDeps(
				createFsProvider([
					"/opt/homebrew/bin/fish",
					"/opt/homebrew/bin/tmux",
					"/bin/zsh",
					"/opt/homebrew/bin/zsh",
				]),
				{
					includeDetected: false,
					loginShells: ["/opt/homebrew/bin/zsh", "/opt/homebrew/bin/fish"],
					customProfiles: [
						custom({ label: "fish", path: "fish", args: ["-l"] }),
						custom({ label: "zsh", path: "zsh" }),
						custom({ label: "tmux", path: "tmux" }),
					],
				},
			),
		);
		expect(summary(profiles)).toEqual([
			{ label: "fish", path: "/opt/homebrew/bin/fish", args: ["-l"] },
			{ label: "zsh", path: "/bin/zsh", args: [] },
		]);
	});

	it("tries login shell paths in order, past a stale $SHELL", async () => {
		const profiles = await detectProfiles(
			unixDeps(createFsProvider(["/usr/local/bin/fish", "/opt/homebrew/bin/fish"]), {
				includeDetected: false,
				loginShells: ["/old/bin/fish", "/opt/homebrew/bin/fish", "/usr/local/bin/fish"],
				customProfiles: [custom({ label: "shell", path: "fish" })],
			}),
		);
		expect(summary(profiles)).toEqual([
			{ label: "shell", path: "/opt/homebrew/bin/fish", args: [] },
		]);
	});

	it("resolves a bare name against the working folder when there is no PATH", async () => {
		const profiles = await detectProfiles(
			unixDeps(createFsProvider(["/Users/me/myshell"]), {
				env: {},
				includeDetected: false,
				customProfiles: [custom({ label: "mine", path: "myshell" })],
			}),
		);
		expect(summary(profiles)[0]?.path).toBe("/Users/me/myshell");
	});

	it("skips files it can't launch and folders with the shell's name", async () => {
		const profiles = await detectProfiles(
			unixDeps(
				createFsProvider(["/b/myshell/readme", "/c/myshell"], { nonExecutable: ["/a/myshell"] }),
				{
					env: { PATH: "/a:/b:/c" },
					includeDetected: false,
					customProfiles: [
						custom({ label: "mine", path: "myshell", env: { FOO: "1", BAR: null } }),
					],
				},
			),
		);
		expect(profiles).toEqual([
			{
				id: "mine",
				label: "mine",
				path: "/c/myshell",
				args: [],
				env: { FOO: "1", BAR: null },
				source: "custom",
				available: true,
			},
		]);
	});
});

describe("loginShellsOf", () => {
	it("lists $SHELL then the user database's shell, absolute and distinct", () => {
		expect(
			loginShellsOf({ SHELL: "/bin/zsh" }, () => ({ shell: "/opt/homebrew/bin/fish" })),
		).toEqual(["/bin/zsh", "/opt/homebrew/bin/fish"]);
		expect(loginShellsOf({ SHELL: "zsh" }, () => ({ shell: "/bin/zsh" }))).toEqual(["/bin/zsh"]);
		expect(
			loginShellsOf({ SHELL: "/bin/zsh" }, () => {
				throw new Error("no user");
			}),
		).toEqual(["/bin/zsh"]);
	});
});
