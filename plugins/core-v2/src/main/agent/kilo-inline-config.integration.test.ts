import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getKiloCliArtifact } from "./cli-distribution/artifacts.js";
import { kiloInlineConfigContent } from "./kilo-inline-config.js";

const KILO_TIMEOUT_MS = 90_000;

function bundledKiloExecutable(): string | undefined {
	try {
		const artifact = getKiloCliArtifact();
		const packageJson = createRequire(import.meta.url).resolve(
			`${artifact.packageName}/package.json`,
		);
		const executable = path.join(path.dirname(packageJson), "bin", artifact.executable);
		return existsSync(executable) ? executable : undefined;
	} catch {
		return undefined;
	}
}

const kiloExecutable = bundledKiloExecutable();

interface PermissionRule {
	readonly permission: string;
	readonly pattern: string;
	readonly action: string;
}

describe.skipIf(!kiloExecutable)("Desktop's inline config in the bundled Kilo CLI", () => {
	let home: string;
	let project: string;

	beforeEach(async () => {
		home = await mkdtemp(path.join(tmpdir(), "kilo-inline-config-"));
		project = path.join(home, "project");
		await mkdir(project);
		await writeUserConfig({ permission: { bash: "allow" } });
	});

	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
	});

	async function writeUserConfig(config: object): Promise<void> {
		const directory = path.join(home, ".config", "kilo");
		await mkdir(directory, { recursive: true });
		await writeFile(path.join(directory, "kilo.json"), JSON.stringify(config));
	}

	function kilo(args: readonly string[], inlineConfig: string) {
		return execa(kiloExecutable!, args, {
			cwd: project,
			reject: false,
			timeout: KILO_TIMEOUT_MS,
			extendEnv: false,
			env: {
				PATH: process.env.PATH,
				SystemRoot: process.env.SystemRoot,
				HOME: home,
				USERPROFILE: home,
				XDG_CONFIG_HOME: path.join(home, ".config"),
				XDG_DATA_HOME: path.join(home, "data"),
				XDG_STATE_HOME: path.join(home, "state"),
				XDG_CACHE_HOME: path.join(home, "cache"),
				KILO_DISABLE_AUTOUPDATE: "true",
				KILO_DISABLE_MODELS_FETCH: "true",
				KILO_DISABLE_LSP_DOWNLOAD: "true",
				KILO_CONFIG_CONTENT: inlineConfig,
			},
		});
	}

	// `kilo debug agent --tool` runs a tool and rejects it only when a rule
	// denies it (asks proceed), so the archive rules are turned into denies to
	// observe, through Kilo's own bash parser and evaluator, which rule wins.
	function runBash(command: string) {
		const inlineConfig = kiloInlineConfigContent([], "https://api.kilo.ai").replaceAll(
			'"ask"',
			'"deny"',
		);
		return kilo(
			[
				"debug",
				"agent",
				"code",
				"--tool",
				"bash",
				"--params",
				JSON.stringify({ command, description: "test" }),
			],
			inlineConfig,
		);
	}

	it("applies the archive rules to a tar extraction into Kilo's config directory, over a user's bash allow", async () => {
		const extraction = await runBash("tar -xf payload.tar -C ~/.config/kilo");
		expect(extraction.exitCode).not.toBe(0);
		expect(extraction.stdout).not.toContain('"result"');

		const echo = await runBash("echo still-allowed");
		expect(echo.exitCode).toBe(0);
		expect(echo.stdout).toContain("still-allowed");
	});

	it("keeps a user's scalar bash allow instead of replacing it with Kilo's default table", async () => {
		const result = await kilo(
			["debug", "agent", "code"],
			kiloInlineConfigContent([], "https://api.kilo.ai"),
		);
		expect(result.exitCode).toBe(0);
		const agent = JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))) as {
			permission: PermissionRule[];
		};
		const bashCatchAll = agent.permission.filter(
			(rule) => rule.permission === "bash" && rule.pattern === "*",
		);
		expect(bashCatchAll.at(-1)?.action).toBe("allow");
	});
});
