import { describe, expect, it } from "vitest";

import type { DetectFs } from "./detect-profiles";
import { createShellDiscovery, type DiscoveryEnvironment } from "./discovery";

function environment(
	files: readonly string[],
	overrides: Partial<DiscoveryEnvironment> = {},
): DiscoveryEnvironment {
	const fs: DetectFs = {
		isExecutableFile: async (path) => files.includes(path),
		isDirectory: async () => false,
		readdir: async () => [],
		readFile: async () => "/bin/zsh\n/bin/bash\n",
	};
	return {
		platform: "linux",
		env: { PATH: "/usr/bin:/bin", SHELL: "/opt/missing/fish" },
		fs,
		execFile: async () => Buffer.from(""),
		arch: "x64",
		homedir: "/home/me",
		cwd: "/home/me",
		loginShells: [],
		...overrides,
	};
}

describe("createShellDiscovery", () => {
	it("starts automatically with shells that exist, as absolute paths, skipping a missing $SHELL", async () => {
		const discovery = createShellDiscovery(() =>
			environment(["/bin/zsh", "/bin/bash", "/usr/bin/bash"]),
		);
		expect(await discovery.automatic()).toEqual([
			{ shell: "/bin/zsh", args: [] },
			{ shell: "/bin/bash", args: [] },
			// The bare `bash` fallback, found on PATH; bare `zsh` resolves to /bin/zsh, already listed.
			{ shell: "/usr/bin/bash", args: [] },
		]);
	});

	it("resolves Windows fallbacks with PATHEXT", async () => {
		const discovery = createShellDiscovery(() =>
			environment(["C:\\Windows\\System32\\cmd.exe", "C:\\pwsh\\pwsh.exe"], {
				platform: "win32",
				env: { SystemRoot: "C:\\Windows", Path: "C:\\pwsh", PATHEXT: ".EXE" },
			}),
		);
		expect((await discovery.automatic()).map((candidate) => candidate.shell)).toEqual([
			"C:\\pwsh\\pwsh.exe",
			"C:\\Windows\\System32\\cmd.exe",
		]);
	});

	it("keeps the unchecked fallbacks when nothing can be found", async () => {
		const discovery = createShellDiscovery(() => environment([]));
		expect((await discovery.automatic())[0]).toEqual({ shell: "/opt/missing/fish", args: [] });
	});

	it("detects with the current environment and custom profiles", async () => {
		const discovery = createShellDiscovery(() => environment(["/bin/zsh"]));
		expect(
			(await discovery.detect([{ id: "z", label: "Login zsh", path: "zsh", args: ["-l"] }])).map(
				({ id, path, args }) => ({ id, path, args }),
			),
		).toEqual([
			{ id: "detected:zsh", path: "/bin/zsh", args: [] },
			{ id: "z", path: "/bin/zsh", args: ["-l"] },
		]);
	});
});
