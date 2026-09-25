import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@kilo-desktop/feature-sdk";
import { createFakeSdk } from "@kilo-desktop/testing";

import { condaContract } from "../contracts/providers/conda.js";
import { EnvironmentsNavIcon, EnvironmentsPage, webRegister } from "./index.js";
import type { EnvironmentsAuthCapabilities } from "../shared/auth-capabilities.js";

const inlineAuthActions = { signIn: async () => true, cancel: () => undefined };

/**
 * The manifest (`plugin.json`) names three exports the shell resolves from
 * this barrel at boot: `settings[0].component` -> `EnvironmentsPage`,
 * `settings[0].icon` -> `EnvironmentsNavIcon`, and `webRegister` if the plugin
 * has renderer-side setup. A broken barrel would make the shell render an
 * unavailable state for `/settings/environments` or crash boot; the checks below
 * catch that at test time.
 */
describe("environments plugin web entry", () => {
	it("exports the components named by plugin.json", () => {
		expect(EnvironmentsPage).toBeDefined();
		expect(typeof EnvironmentsPage).toBe("function");
		expect(EnvironmentsNavIcon).toBeDefined();
	});

	it("webRegister registers the conda provider's tools", () => {
		const sdk = createFakeSdk({ featureId: "environments" });
		expect(() => webRegister(sdk)).not.toThrow();

		const tools = sdk.services.toolRegistry.all();
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			"conda.channels.list",
			"conda.envs.clone",
			"conda.envs.create",
			"conda.envs.createFromFile",
			"conda.envs.delete",
			"conda.envs.list",
			"conda.packages.install",
			"conda.packages.list",
			"conda.packages.remove",
			"conda.packages.update",
			"conda.repodata.find",
			"conda.setup.open",
		]);
		const listTool = tools.find((tool) => tool.name === "conda.envs.list");
		expect(listTool?.annotations).toMatchObject({ readOnlyHint: true });
		expect(listTool?.exposeToModelContext).toBe(true);

		const channelsTool = tools.find((tool) => tool.name === "conda.channels.list");
		expect(channelsTool?.annotations).toMatchObject({ readOnlyHint: true });
		expect(channelsTool?.exposeToModelContext).toBe(true);

		// `create` is a mutating op but not destructive (it adds state).
		const createTool = tools.find((tool) => tool.name === "conda.envs.create");
		expect(createTool?.annotations?.destructiveHint).toBeUndefined();
		expect(createTool?.exposeToModelContext).toBe(true);

		// `delete` MUST advertise `destructiveHint: true` so MCP hosts
		// surface a confirmation prompt before invocation.
		const deleteTool = tools.find((tool) => tool.name === "conda.envs.delete");
		expect(deleteTool?.annotations).toMatchObject({ destructiveHint: true });
		expect(deleteTool?.exposeToModelContext).toBe(true);

		// `repodata.find` is a read-only lookup over the channel index, backed by
		// the bridge's `repodata.find` method (present since payload 0.1.4).
		const repodataTool = tools.find((tool) => tool.name === "conda.repodata.find");
		expect(repodataTool?.annotations).toMatchObject({ readOnlyHint: true });
		expect(repodataTool?.exposeToModelContext).toBe(true);

		// `packages.list` is read-only — lists installed packages and their source
		// channel, distinguishing pip (channel === "pypi") from conda packages.
		const listPackagesTool = tools.find((tool) => tool.name === "conda.packages.list");
		expect(listPackagesTool?.annotations).toMatchObject({ readOnlyHint: true });
		expect(listPackagesTool?.exposeToModelContext).toBe(true);

		// Same flat-schema guard as install/remove: no allOf.
		const listPkgSchema = listPackagesTool?.inputSchema as {
			allOf?: unknown;
			type?: string;
			properties?: Record<string, { type?: string }>;
		};
		expect(listPkgSchema.allOf).toBeUndefined();
		expect(listPkgSchema.type).toBe("object");
		expect(listPkgSchema.properties?.name?.type).toBe("string");
		expect(listPkgSchema.properties?.prefix?.type).toBe("string");

		// `packages.install` adds state into an existing env — mutating but NOT
		// destructive, and exposed to the model so a prompt can install packages.
		const installTool = tools.find((tool) => tool.name === "conda.packages.install");
		expect(installTool?.annotations?.destructiveHint).toBeUndefined();
		expect(installTool?.exposeToModelContext).toBe(true);

		// Regression guard: the published input schema must be a single flat
		// object, NOT an `allOf` intersection. An intersection lowers to two
		// objects each with `additionalProperties: false`, which is
		// unsatisfiable and makes every tool call fail host-side validation.
		const installSchema = installTool?.inputSchema as {
			allOf?: unknown;
			type?: string;
			required?: string[];
			properties?: Record<string, { type?: string }>;
		};
		expect(installSchema.allOf).toBeUndefined();
		expect(installSchema.type).toBe("object");
		expect(installSchema.required).toContain("packages");
		expect(installSchema.properties?.packages?.type).toBe("array");
		expect(installSchema.properties?.name?.type).toBe("string");
		expect(installSchema.properties?.prefix?.type).toBe("string");

		// `packages.remove` uninstalls packages — MUST advertise `destructiveHint`
		// so MCP hosts prompt for confirmation. Same flat-schema guard as install.
		const removeTool = tools.find((tool) => tool.name === "conda.packages.remove");
		expect(removeTool?.annotations).toMatchObject({ destructiveHint: true });
		expect(removeTool?.exposeToModelContext).toBe(true);
		const removeSchema = removeTool?.inputSchema as {
			allOf?: unknown;
			type?: string;
			required?: string[];
			properties?: Record<string, { type?: string }>;
		};
		expect(removeSchema.allOf).toBeUndefined();
		expect(removeSchema.type).toBe("object");
		expect(removeSchema.required).toContain("packages");
		expect(removeSchema.properties?.packages?.type).toBe("array");

		// `packages.update` mutates existing versions (non-additive) and can break
		// the environment — MUST advertise `destructiveHint` so MCP hosts confirm.
		const updateTool = tools.find((tool) => tool.name === "conda.packages.update");
		expect(updateTool?.annotations).toMatchObject({ destructiveHint: true });
		expect(updateTool?.exposeToModelContext).toBe(true);
		const updateSchema = updateTool?.inputSchema as {
			allOf?: unknown;
			type?: string;
			properties?: Record<string, { type?: string }>;
		};
		expect(updateSchema.allOf).toBeUndefined();
		expect(updateSchema.type).toBe("object");
		expect(updateSchema.properties?.packages?.type).toBe("array");
		expect(updateSchema.properties?.updateAll?.type).toBe("boolean");
	});

	it("waits for Anaconda sign-in before opening environment setup from chat", async () => {
		const navigate = vi.fn();
		const requireSignIn = vi.fn(async () => true);
		const sdk = createFakeSdk({ featureId: "environments", navigation: { navigate } });
		sdk.plugins.expose("authGate", {
			requireSignIn,
			...inlineAuthActions,
		} satisfies EnvironmentsAuthCapabilities["authGate"]);
		webRegister(sdk);

		await sdk.services.toolRegistry.invoke("environments", "conda.setup.open", {});

		expect(requireSignIn).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith("/settings/environments", undefined);
	});

	it("does not navigate when environment setup sign-in is dismissed", async () => {
		const navigate = vi.fn();
		const sdk = createFakeSdk({ featureId: "environments", navigation: { navigate } });
		sdk.plugins.expose("authGate", {
			requireSignIn: async () => false,
			...inlineAuthActions,
		} satisfies EnvironmentsAuthCapabilities["authGate"]);
		webRegister(sdk);

		await expect(
			sdk.services.toolRegistry.invoke("environments", "conda.setup.open", {}),
		).rejects.toThrow("Anaconda sign-in is required");
		expect(navigate).not.toHaveBeenCalled();
	});

	it("opens environment setup directly for authenticated users", async () => {
		const session: AuthSession = { status: "authenticated", user: { username: "ada" } };
		const navigate = vi.fn();
		const requireSignIn = vi.fn(async () => true);
		const sdk = createFakeSdk({
			featureId: "environments",
			auth: { peek: () => session },
			navigation: { navigate },
		});
		sdk.plugins.expose("authGate", {
			requireSignIn,
			...inlineAuthActions,
		} satisfies EnvironmentsAuthCapabilities["authGate"]);
		webRegister(sdk);

		await sdk.services.toolRegistry.invoke("environments", "conda.setup.open", {});

		expect(requireSignIn).not.toHaveBeenCalled();
		expect(navigate).toHaveBeenCalledWith("/settings/environments", undefined);
	});

	it("forces the sign-in gate for authenticated users when the test flag is set", async () => {
		const session: AuthSession = { status: "authenticated", user: { username: "ada" } };
		const navigate = vi.fn();
		const requireSignIn = vi.fn(async () => true);
		const sdk = createFakeSdk({
			featureId: "environments",
			auth: { peek: () => session },
			featureFlags: { peek: () => ({ "force-anaconda-sign-in-gate": true }) },
			navigation: { navigate },
		});
		sdk.plugins.expose("authGate", {
			requireSignIn,
			...inlineAuthActions,
		} satisfies EnvironmentsAuthCapabilities["authGate"]);
		webRegister(sdk);

		await sdk.services.toolRegistry.invoke("environments", "conda.setup.open", {});

		expect(requireSignIn).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith("/settings/environments", undefined);
	});

	it("waits for sign-in before a chat-triggered environment create", async () => {
		const create = vi.fn(async () => ({
			jobId: "job-1",
			environment: { name: "chat-env", prefix: "/envs/chat-env" },
		}));
		const requireSignIn = vi.fn(async () => true);
		const sdk = createFakeSdk({
			featureId: "environments",
			channels: condaContract,
			handlers: { "conda.envs.create": create },
		});
		sdk.plugins.expose("authGate", {
			requireSignIn,
			...inlineAuthActions,
		} satisfies EnvironmentsAuthCapabilities["authGate"]);
		webRegister(sdk);

		await sdk.services.toolRegistry.invoke("environments", "conda.envs.create", {
			name: "chat-env",
		});

		expect(requireSignIn).toHaveBeenCalledOnce();
		expect(create).toHaveBeenCalledWith({ name: "chat-env" });
	});
});
