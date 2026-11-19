import { describe, expect, it, vi } from "vitest";

import { KernelError } from "@kilo-desktop/kernel";
import type { ToolCallContext } from "@kilo-desktop/plugin-core/contracts";

import manifest from "../../plugin.json";
import { formatEnvironmentsErrorMessage } from "../contracts/common";
import type { CondaMethods } from "./conda-service";
import { condaTools, withPolicyFailureReporting } from "./tools";

const CONTEXT: ToolCallContext = {
	chatId: null,
	workSessionId: null,
	workspaceId: null,
	callId: null,
	external: false,
	signal: new AbortController().signal,
};

function setup() {
	const calls: { method: string; input: unknown }[] = [];
	const conda = new Proxy({} as CondaMethods, {
		get: (_target, method: string) => (input: unknown) => {
			calls.push({ method, input });
			return Promise.resolve({ method });
		},
	});
	let opened = 0;
	const tools = condaTools({ conda: () => conda, openSettings: () => void opened++ });
	return { tools, calls, opened: () => opened };
}

/** Validates like the tool gateway, then runs the tool. */
async function invoke(name: string, args: unknown) {
	const tool = setup().tools[name];
	if (!tool) throw new Error(`No tool ${name}`);
	const parsed = tool.input.safeParse(args);
	if (!parsed.success)
		throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
	return tool.run(parsed.data, CONTEXT);
}

function registry() {
	const { tools } = setup();
	return {
		all: () => Object.entries(tools).map(([name, tool]) => ({ name, ...tool })),
		invoke: (_feature: string, name: string, args: unknown) => Promise.resolve(invoke(name, args)),
	};
}

describe("the conda agent tools", () => {
	it("implement exactly the tools the manifest contributes, with origin's names", () => {
		const contributed = manifest.contributes.extensions["kilo.core/tool"].map((tool) => tool.id);
		expect(Object.keys(setup().tools).sort()).toEqual([...contributed].sort());
		expect(contributed).not.toContain("conda.envs.createFromFile");
	});

	it("forward validated input to the conda methods", async () => {
		const { tools, calls } = setup();
		const context = CONTEXT;
		await tools["conda.envs.list"]!.run({}, context);
		await tools["conda.packages.install"]!.run(
			tools["conda.packages.install"]!.input.parse({ name: "dev", packages: ["numpy"] }),
			context,
		);
		expect(calls).toEqual([
			{ method: "listEnvironments", input: undefined },
			{ method: "installPackages", input: { name: "dev", packages: ["numpy"] } },
		]);
	});

	it("never let the agent choose an environment's location", () => {
		const parsed = setup().tools["conda.envs.create"]!.input.parse({
			name: "dev",
			prefix: "/etc/evil",
		});
		expect(parsed).toEqual({ name: "dev" });
	});
});

/** Agent tools that target an existing environment by `name` or `prefix`. */
const ENV_TARGET_TOOLS = [
	{ tool: "conda.envs.delete", extra: {} },
	{ tool: "conda.packages.list", extra: {} },
	{ tool: "conda.packages.install", extra: { packages: ["numpy"] } },
	{ tool: "conda.packages.remove", extra: { packages: ["numpy"] } },
	{ tool: "conda.packages.update", extra: { packages: ["numpy"] } },
] as const;

const PROD_PREFIX = "/home/user/anaconda3/envs/prod";

describe("agent conda tools require an unambiguous environment", () => {
	it.each(ENV_TARGET_TOOLS)("$tool refuses both name and prefix", async ({ tool, extra }) => {
		await expect(
			registry().invoke("environments", tool, { name: "scratch", prefix: PROD_PREFIX, ...extra }),
		).rejects.toThrow(/exactly one of `name` or `prefix`/);
	});

	it.each(ENV_TARGET_TOOLS)("$tool accepts a name or a prefix alone", async ({ tool, extra }) => {
		await expect(
			registry().invoke("environments", tool, { name: "scratch", ...extra }),
		).resolves.toBeDefined();
		await expect(
			registry().invoke("environments", tool, { prefix: PROD_PREFIX, ...extra }),
		).resolves.toBeDefined();
	});
});

/** Matches the model-facing channel refusal message from the contract. */
const CHANNEL_REFUSAL = /cannot be a URL or a local path/i;

/** Every agent-initiated tool that accepts a `channels` argument. */
const CHANNEL_TOOLS = [
	"conda.envs.create",
	"conda.packages.install",
	"conda.packages.update",
	"conda.repodata.find",
] as const;

/** Non-named channels the agent must not be able to point conda at. */
const NON_NAMED_CHANNELS = [
	"https://evil.example/conda",
	"file:///tmp/channel",
	"/tmp/channel",
	"~/channel",
	"C:\\channel",
] as const;

describe("agent conda tools refuse non-named channels (C1 gate 2)", () => {
	it.each(CHANNEL_TOOLS)("%s refuses a URL or local-path channel", async (tool) => {
		for (const channel of NON_NAMED_CHANNELS) {
			await expect(
				registry().invoke("environments", tool, {
					name: "dev",
					packages: ["numpy"],
					channels: [channel],
				}),
			).rejects.toThrow(CHANNEL_REFUSAL);
		}
	});

	it("lets named channels pass channel validation", async () => {
		await expect(
			registry().invoke("environments", "conda.packages.install", {
				name: "dev",
				packages: ["numpy"],
				channels: ["defaults", "conda-forge"],
			}),
		).resolves.toEqual({ method: "installPackages" });
	});

	it("exposes channel add/remove and refuses non-named channels", async () => {
		const tools = registry()
			.all()
			.map((tool) => tool.name);
		expect(tools).toContain("conda.channels.add");
		expect(tools).toContain("conda.channels.remove");

		for (const tool of ["conda.channels.add", "conda.channels.remove"] as const) {
			for (const channel of NON_NAMED_CHANNELS) {
				await expect(registry().invoke("environments", tool, { channel })).rejects.toThrow(
					CHANNEL_REFUSAL,
				);
			}
			await expect(
				registry().invoke("environments", tool, { channel: "conda-forge" }),
			).resolves.toBeDefined();
		}
	});
});

describe("Anaconda channel preference", () => {
	it.each(["conda.envs.create", "conda.packages.install", "conda.packages.update"])(
		"%s always advertises the preference",
		(name) => {
			const tool = registry()
				.all()
				.find((candidate) => candidate.name === name);
			expect(tool?.description).toMatch(/prefer Anaconda's channels/i);
			expect(tool?.description).toMatch(/blocked by .*policy is not unavailable/i);
		},
	);
});

describe("package policy and Anaconda sign-in guidance", () => {
	it.each([
		"conda.envs.create",
		"conda.envs.clone",
		"conda.packages.install",
		"conda.packages.update",
		"conda.repodata.find",
	])("%s tells the agent to report a block verbatim and never route around it", (name) => {
		const description = registry()
			.all()
			.find((candidate) => candidate.name === name)?.description;
		expect(description).toMatch(/POLICY_BLOCKED/);
		expect(description).toMatch(/\[policy\]/);
		expect(description).toMatch(/verbatim/i);
		expect(description).toMatch(/do not retry from another channel, pip or a URL/i);
		expect(description).toMatch(/administrator/i);
		expect(description).toMatch(/NOT_SIGNED_IN/);
		expect(description).toMatch(/CHANNEL_ACCESS_DENIED/);
		expect(description).toMatch(/sign in to Anaconda \(not Kilo\)/i);
		expect(description).toMatch(/never ask .* for a token/i);
	});
});

const BLOCKED = {
	package: "pillow",
	version: "8.4.0",
	channel: "https://repo.anaconda.cloud/repo/acme/main",
	org: "acme",
	policy: "No critical CVEs",
	policyId: "0b7c3c1e-2f4e-4a5b-9a51-3f6c9e1d2a10",
	reason: "CVE-2022-22817 (critical)",
};

function failingTools(error: unknown) {
	const tracked: { event: string; data: Record<string, unknown> }[] = [];
	const conda = new Proxy({} as CondaMethods, {
		get: () => () => Promise.reject(error),
	});
	const tools = condaTools({
		conda: () => conda,
		openSettings: () => undefined,
		track: (event, data) => void tracked.push({ event, data }),
	});
	const run = (name: string, args: unknown) => {
		const tool = tools[name]!;
		return Promise.resolve().then(() => tool.run(tool.input.parse(args), CONTEXT));
	};
	return { run, tracked };
}

describe("a tool that fails on a package policy", () => {
	const blockedError = new KernelError(
		"BUSINESS",
		formatEnvironmentsErrorMessage(
			"POLICY_BLOCKED",
			"pillow 8.4.0 is blocked by your organization's policy 'No critical CVEs'",
			{ blocked: [BLOCKED] },
		),
	);

	it("rejects with the error unchanged, so the policy line reaches the agent", async () => {
		const { run } = failingTools(blockedError);

		const rejection = await run("conda.packages.install", {
			name: "dev",
			packages: ["pillow=8.4.0"],
		}).catch((error: unknown) => error);

		expect(rejection).toBe(blockedError);
		expect((rejection as Error).message.split("\n").at(-1)).toBe(
			`[policy] ${JSON.stringify({ blocked: [BLOCKED] })}`,
		);
	});

	it("sends the policy-blocked event with counts and policy ids only", async () => {
		const { run, tracked } = failingTools(blockedError);

		await run("conda.packages.install", { name: "dev", packages: ["pillow=8.4.0"] }).catch(
			() => undefined,
		);

		expect(tracked).toEqual([
			{
				event: "environment-policy-blocked",
				data: {
					surface: "agent_tool",
					errorCode: "POLICY_BLOCKED",
					blockedCount: 1,
					policyNote: false,
					policyIds: [BLOCKED.policyId],
				},
			},
		]);
	});

	it("passes the tool call's context through to the tool unchanged", async () => {
		const run = vi.fn((_input: unknown, _context: unknown) => "ran");
		const report = vi.fn();

		await expect(withPolicyFailureReporting(run, report)({ name: "dev" }, CONTEXT)).resolves.toBe(
			"ran",
		);
		expect(run).toHaveBeenCalledExactlyOnceWith({ name: "dev" }, CONTEXT);
		expect(report).not.toHaveBeenCalled();
	});

	it("reports a tool that throws synchronously, then rethrows it unchanged", async () => {
		const run = () => {
			throw blockedError;
		};
		const report = vi.fn();

		await expect(withPolicyFailureReporting(run, report)({}, CONTEXT)).rejects.toBe(blockedError);
		expect(report).toHaveBeenCalledExactlyOnceWith(blockedError);
	});

	it("sends nothing for other failures", async () => {
		const { run, tracked } = failingTools(
			new KernelError("BUSINESS", formatEnvironmentsErrorMessage("SOLVE_FAILED", "conflict")),
		);

		await expect(run("conda.packages.install", { name: "dev", packages: ["x"] })).rejects.toThrow(
			"SOLVE_FAILED: conflict",
		);
		expect(tracked).toEqual([]);
	});
});

describe("no-channels ask flow", () => {
	it.each(["conda.envs.create", "conda.packages.install", "conda.packages.update"])(
		"%s offers `defaults` as a yes/no and names no alternative channel",
		(name) => {
			const tool = registry()
				.all()
				.find((candidate) => candidate.name === name);
			expect(tool?.description).toMatch(/NO_CHANNELS_CONFIGURED/);
			expect(tool?.description).toMatch(/do not pick or propose a channel yourself/i);
			expect(tool?.description).toMatch(/do not offer or name any other channel/i);
			expect(tool?.description).toMatch(/Shall I use `defaults`\?/);
		},
	);

	it("conda.channels.list explains that an empty list means nothing is configured", () => {
		const tool = registry()
			.all()
			.find((candidate) => candidate.name === "conda.channels.list");
		expect(tool?.description).toMatch(/EMPTY array means no channels are configured/);
	});
});
