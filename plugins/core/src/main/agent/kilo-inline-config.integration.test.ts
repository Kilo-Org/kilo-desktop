import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { kiloInlineConfigContent } from "./kilo-inline-config.js";
import { bundledKiloExecutable } from "../../test/agent/kilo-executable.js";

const KILO_TIMEOUT_MS = 90_000;

const kiloExecutable = bundledKiloExecutable();

interface PermissionRule {
	readonly action: string;
	readonly resource: string;
	readonly effect: string;
}

interface AgentInfo {
	readonly id: string;
	readonly permissions: readonly PermissionRule[];
}

/**
 * Kilo v2's `Wildcard.match` (`packages/core/src/util/wildcard.ts`): `*` is any
 * run of characters, `?` one character, and a trailing ` *` is optional, so
 * `"tar *"` also matches a bare `tar`.
 */
function matches(pattern: string, value: string): boolean {
	let escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	if (escaped.endsWith(" .*")) escaped = `${escaped.slice(0, -3)}( .*)?`;
	return new RegExp(`^${escaped}$`, "s").test(value);
}

/** What Kilo v2 decides for a shell command: the last rule that matches wins. */
function shellEffect(agent: AgentInfo, command: string): string | undefined {
	return agent.permissions.findLast(
		(rule) => matches(rule.action, "shell") && matches(rule.resource, command),
	)?.effect;
}

describe.skipIf(!kiloExecutable)("Desktop's inline config in the bundled Kilo CLI", () => {
	let home: string;
	let project: string;

	beforeEach(async () => {
		home = await mkdtemp(path.join(tmpdir(), "kilo-inline-config-"));
		project = path.join(home, "project");
		await mkdir(project);
		await writeUserConfig({ permissions: [{ action: "shell", resource: "*", effect: "allow" }] });
	});

	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
	});

	async function writeUserConfig(config: object): Promise<void> {
		const directory = path.join(home, ".config", "kilo2");
		await mkdir(directory, { recursive: true });
		await writeFile(path.join(directory, "kilo2.json"), JSON.stringify(config));
	}

	/** The agents Kilo resolves in the project, with every config layer applied. */
	async function resolvedAgents(inlineConfig: string): Promise<AgentInfo[]> {
		const result = await execa(kiloExecutable!, ["debug", "agents", "--standalone"], {
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
				KILO_CONFIG_CONTENT: inlineConfig,
			},
		});
		expect(result.exitCode, result.stderr).toBe(0);
		return JSON.parse(result.stdout.slice(result.stdout.indexOf("["))) as AgentInfo[];
	}

	it("makes archive commands ask over a user's shell allow, and leaves other commands allowed", async () => {
		const agents = await resolvedAgents(kiloInlineConfigContent([], "https://api.kilo.ai"));
		const code = agents.find((agent) => agent.id === "code");

		expect(code).toBeDefined();
		expect(shellEffect(code!, "tar -xf payload.tar -C ~/.config/kilo2")).toBe("ask");
		expect(shellEffect(code!, "tar")).toBe("ask");
		expect(shellEffect(code!, "gunzip payload.gz")).toBe("ask");
		expect(shellEffect(code!, "echo still-allowed")).toBe("allow");
	});
});
