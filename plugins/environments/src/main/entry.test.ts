import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { KernelServices } from "@kilo-desktop/kernel";

import { BRIDGE_SERVICE_KEY, ENVIRONMENTS_SETTINGS_SECTION } from "../contracts/index";
import {
	BLOCKED_POLICY_ID,
	blockedByPolicy,
	bootEnvironmentsMain,
	notSignedIn,
	recordingLogger,
	stopEnvironmentsMains,
} from "./test-boot";

const boot = bootEnvironmentsMain;

const CPU = "llama.cpp==0.6.0=cpu_*";
const METAL = "llama.cpp==0.6.0=mps_*";
const MAIN_URL = "https://repo.anaconda.com/pkgs/main";
const APPLE_SILICON = {
	platform: "darwin",
	arch: "arm64",
	release: "24.0.0",
	gpus: [],
} as const;

const ownMessages = (messages: unknown[][]) =>
	messages.filter(([message]) => !String(message).startsWith("[kilo.environments] Contribution"));

afterEach(stopEnvironmentsMains);

describe("kilo.environments in main", () => {
	it("serves the person's conda environments through the bridge once the flag is on", async () => {
		const { conda, bridges, main } = await boot({
			answers: { list: [{ name: "dev", prefix: "/conda/envs/dev" }] },
		});

		expect(conda().getState()).toEqual({ status: "ready" });
		await expect(conda().methods.listEnvironments(undefined)).resolves.toEqual([
			{ name: "dev", prefix: "/conda/envs/dev" },
		]);
		expect(bridges).toHaveLength(1);
		expect(bridges[0]!.calls.map((call) => call.method)).toEqual(["list"]);
		expect(bridges[0]!.starts).toBe(1);
		expect(
			main.kernelSdk.domainObjects.get(KernelServices)!.getState().services[BRIDGE_SERVICE_KEY]
				?.status,
		).toBe("ready");
	});

	it("refuses while the flag is off, and follows the flag", async () => {
		const { conda, setFlag, resolves } = await boot({ flag: false });

		expect(conda().getState().status).toBe("disabled");
		expect(resolves()).toBe(0);
		await expect(conda().methods.listEnvironments(undefined)).rejects.toThrow("not enabled");

		setFlag(true);
		await expect.poll(() => conda().getState().status).toBe("ready");
	});

	it("is unavailable without the bridge payload, warning once", async () => {
		const { logger, warnings } = recordingLogger();
		const { conda } = await boot({ bridge: null, logger });

		expect(conda().getState().status).toBe("unavailable");
		await expect(conda().methods.listChannels(undefined)).rejects.toThrow("payload was not found");
		expect(ownMessages(warnings).flat().join("\n")).toContain(
			"The conda bridge payload was not found.",
		);
	});

	it("forgets cached package lookups when the Anaconda account changes", async () => {
		const { conda, bridges, anacondaAccountChanged } = await boot({
			withAnaconda: true,
			answers: { findRepodata: [] },
		});
		const lookups = () => bridges[0]!.calls.filter((call) => call.method === "findRepodata");

		await conda().methods.findRepodata({ names: ["pillow"] });
		await conda().methods.findRepodata({ names: ["pillow"] });
		expect(lookups()).toHaveLength(1);

		anacondaAccountChanged();
		await conda().methods.findRepodata({ names: ["pillow"] });

		expect(lookups()).toHaveLength(2);
	});

	it("emits each write's progress and returns its job id", async () => {
		const { conda } = await boot({ answers: { remove: undefined } });
		const statuses: string[] = [];
		conda().on("job-progress", (event) => statuses.push(event.status));

		const result = await conda().methods.deleteEnvironment({ name: "dev" });

		expect(result).toEqual({ jobId: expect.stringMatching(/^conda-/), name: "dev" });
		await expect.poll(() => statuses).toEqual(["queued", "running", "succeeded"]);
	});

	it("asks the person for an environment file", async () => {
		const picked = await boot({ pickedFile: "/work/environment.yml" });
		await expect(picked.conda().methods.pickEnvironmentFile({})).resolves.toEqual({
			filePath: "/work/environment.yml",
		});
		const cancelled = await boot({ pickedFile: null });
		await expect(cancelled.conda().methods.pickEnvironmentFile({})).resolves.toEqual({
			filePath: null,
		});
	});

	it("creates plugin-owned environments whatever the flag says", async () => {
		const { condaRuntime, bridges } = await boot({
			flag: false,
			answers: { create: { name: "llama", prefix: "/x" } },
		});

		const result = await condaRuntime().methods.ensureEnvironment({
			name: "llama",
			packages: ["llama.cpp"],
		});

		expect(result.prefixPath).toMatch(/conda[\\/]envs[\\/]llama$/);
		expect(bridges[0]!.calls[0]).toMatchObject({
			method: "create",
			args: [
				{ name: "llama", packages: ["llama.cpp"], channels: ["anaconda", "defaults"] },
				undefined,
				{ prefix: result.prefixPath },
			],
		});
	});

	it("gives plugin-owned environments a win-arm64 bridge on Windows ARM64", async () => {
		const { bridges } = await boot({ platform: "win32", arch: "arm64" });

		expect(bridges.map((bridge) => bridge.environment)).toEqual([
			undefined,
			{ CONDA_SUBDIR: "win-arm64" },
		]);
	});

	it("gives every bridge the build's Sentry DSN", async () => {
		const dsn = "https://key@sentry.example/2";
		const { bridges } = await boot({ platform: "win32", arch: "arm64", sentryDsn: dsn });

		expect(bridges.map((bridge) => bridge.environment)).toEqual([
			{ BRIDGE_SENTRY_DSN: dsn },
			{ BRIDGE_SENTRY_DSN: dsn, CONDA_SUBDIR: "win-arm64" },
		]);
	});

	it("contributes the conda tools under origin's names, run through the conda methods", async () => {
		const { callTool, tool, bridges } = await boot({
			answers: { listChannels: ["defaults"] },
		});

		await expect(callTool("conda.channels.list", {})).resolves.toEqual(["defaults"]);
		expect(bridges[0]!.calls.map((call) => call.method)).toEqual(["listChannels"]);
		expect(tool("conda.packages.install")!.metadata).toMatchObject({
			approval: "ask",
			requiresSignIn: true,
			external: true,
			signInPrompt: { toolsLabel: "Desktop's Python environment tools" },
		});
	});

	it("hands the agent a policy block unchanged and reports it without names", async () => {
		const failure = blockedByPolicy();
		const { callTool, tracked } = await boot({
			answers: { install: () => Promise.reject(failure) },
		});

		await expect(
			callTool("conda.packages.install", { name: "dev", packages: ["pillow=8.4.0"] }),
		).rejects.toThrow(failure.message);

		await expect
			.poll(() => tracked)
			.toEqual([
				{
					event: "Environment Policy Blocked",
					data: {
						surface: "agent_tool",
						errorCode: "POLICY_BLOCKED",
						blockedCount: 1,
						policyNote: false,
						policyIds: [BLOCKED_POLICY_ID],
					},
				},
			]);
	});

	it("reports an Anaconda sign-in refusal from a tool, and tracks nothing for the window's own calls", async () => {
		const failure = notSignedIn();
		const { callTool, conda, tracked } = await boot({
			answers: { findRepodata: () => Promise.reject(failure) },
		});

		await expect(conda().methods.findRepodata({ names: ["pillow"] })).rejects.toThrow(
			/^NOT_SIGNED_IN/,
		);
		await expect(callTool("conda.repodata.find", { names: ["pillow"] })).rejects.toThrow(
			failure.message,
		);

		await expect
			.poll(() => tracked.map(({ data }) => data["errorCode"]))
			.toEqual(["NOT_SIGNED_IN"]);
	});

	it("opens Conda Environments settings for the setup tool", async () => {
		const { callTool, openSettings } = await boot();

		await expect(callTool("conda.setup.open", {})).resolves.toEqual({ opened: true });

		expect(openSettings).toHaveBeenCalledWith(ENVIRONMENTS_SETTINGS_SECTION);
	});

	it("asks before conda-family commands in every chat, and hides its tools while unavailable", async () => {
		const ready = await boot();
		const config = await ready.chatConfig();
		expect(config.disableTools).toBeUndefined();
		expect(config.permissions).toContainEqual({
			permission: "bash",
			pattern: "*conda install*",
			action: "ask",
		});

		const disabled = await boot({ flag: false });
		const hidden = await disabled.chatConfig();
		expect(hidden.permissions).toEqual(config.permissions);
		expect(hidden.disableTools).toContain("desktop_environments_conda_envs_list");
		expect(hidden.disableTools).toContain("desktop_environments_conda_packages_install");
		expect(hidden.disableTools).toContain("desktop_environments_conda_setup_open");
	});

	it("releases the bridge when its service stops, and disposes it on deactivation", async () => {
		const { main, bridges, conda } = await boot({ answers: { list: [] } });
		await conda().methods.listEnvironments(undefined);

		await main.stop();

		expect(bridges[0]!.releases).toBe(1);
		expect(bridges[0]!.disposed).toBe(true);
	});

	describe("llama.cpp for the Local Model Server", () => {
		it("installs llama.cpp into the runtime environment whatever the flag says", async () => {
			const checked: string[] = [];
			const { llamaRuntime, bridges, storageDir } = await boot({
				flag: false,
				answers: { create: { name: "local-inference-llama", prefix: "/x" } },
				llama: {
					readHost: async () => APPLE_SILICON,
					accessFile: async (file) => void checked.push(file),
				},
			});

			expect(llamaRuntime()!.metadata).toEqual({ title: "Conda" });
			const executable = await llamaRuntime()!.implementation!.resolveExecutable();

			const prefix = path.join(storageDir, "conda", "envs", "local-inference-llama");
			expect(executable).toBe(path.join(prefix, "bin", "llama-server"));
			expect(checked).toEqual([executable]);
			expect(bridges[0]!.calls[0]).toMatchObject({
				method: "create",
				args: [
					{ name: "local-inference-llama", packages: [METAL], channels: ["defaults"] },
					undefined,
					{ prefix },
				],
			});
		});

		it("falls back through each flavour's channels, warning of each failure", async () => {
			const { logger, warnings } = recordingLogger();
			const { llamaRuntime, bridges } = await boot({
				logger,
				answers: {
					create: ({ packages, channels }: { packages: string[]; channels: string[] }) => {
						if (packages[0] === METAL || channels[0] === "defaults") {
							throw new Error(`no ${packages[0]} in ${channels[0]}`);
						}
						return { name: "local-inference-llama", prefix: "/x" };
					},
				},
				llama: { readHost: async () => APPLE_SILICON, accessFile: async () => {} },
			});

			await expect(llamaRuntime()!.implementation!.resolveExecutable()).resolves.toMatch(
				/llama-server$/,
			);

			expect(
				bridges[0]!.calls.map((call) => {
					const [{ packages, channels }] = call.args as [
						{ packages: string[]; channels: string[] },
					];
					return [packages[0], channels[0]];
				}),
			).toEqual([
				[METAL, "defaults"],
				[METAL, MAIN_URL],
				[CPU, "defaults"],
				[CPU, MAIN_URL],
			]);
			const llamaWarnings = ownMessages(warnings)
				.flat()
				.filter((message) => String(message).includes("Could not install llama.cpp"));
			expect(llamaWarnings).toHaveLength(3);
		});

		it("rejects with the last error when no flavour installs", async () => {
			const { llamaRuntime } = await boot({
				answers: {
					create: ({ packages }: { packages: string[] }) => {
						throw new Error(`failed ${packages[0]}`);
					},
				},
				llama: { readHost: async () => APPLE_SILICON, accessFile: async () => {} },
			});

			await expect(llamaRuntime()!.implementation!.resolveExecutable()).rejects.toThrow(
				`failed ${CPU}`,
			);
		});
	});

	describe("without the plugins it works with", () => {
		it("activates without kilo.core, kilo.shell, kilo.chat or kilo.local-inference, saying nothing", async () => {
			const { logger, warnings, errors } = recordingLogger();
			const host = await boot({
				withoutCore: true,
				withoutShell: true,
				withoutChat: true,
				withoutLocalInference: true,
				logger,
				answers: { list: [] },
			});

			expect(host.conda().getState().status).toBe("ready");
			await expect(host.conda().methods.listEnvironments(undefined)).resolves.toEqual([]);
			expect(host.tool("conda.envs.list")).toBeUndefined();
			expect(host.chatConfigContribution()).toBeUndefined();
			expect(host.llamaRuntime()).toBeUndefined();
			expect(ownMessages(warnings)).toEqual([]);
			expect(ownMessages(errors)).toEqual([]);
		});

		it("opens nothing from the setup tool without kilo.shell", async () => {
			const host = await boot({ withoutShell: true });

			await expect(host.callTool("conda.setup.open")).resolves.toEqual({ opened: true });
			expect(host.openSettings).not.toHaveBeenCalled();
		});
	});
});
