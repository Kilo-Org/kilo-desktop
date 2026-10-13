import { describe, expect, it, vi } from "vitest";

import type { AuthSession, RegisteredTool } from "@kilo-desktop/feature-sdk";

import { isRefusedForSignIn } from "./tool-sign-in.js";

const tool = (requiresSignIn: boolean): RegisteredTool => ({
	featureId: "environments",
	id: "environments.conda.envs.create",
	name: "conda.envs.create",
	description: "Create",
	exposeToModelContext: true,
	requiresSignIn,
});

const ENV_CREATE = "desktop_environments_conda_envs_create";

describe("isRefusedForSignIn", () => {
	it.each([{ status: "anonymous" }, { status: "error", reason: "offline" }] as const)(
		"is true for a sign-in tool while the session is $status",
		async (session) => {
			await expect(
				isRefusedForSignIn(ENV_CREATE, { tools: [tool(true)], getSession: async () => session }),
			).resolves.toBe(true);
		},
	);

	it("is false once the user is signed in", async () => {
		const session: AuthSession = { status: "authenticated", user: {} };

		await expect(
			isRefusedForSignIn(ENV_CREATE, { tools: [tool(true)], getSession: async () => session }),
		).resolves.toBe(false);
	});

	it("is false, without asking for the session, for tools that do not require sign-in", async () => {
		const getSession = vi.fn(async (): Promise<AuthSession> => ({ status: "anonymous" }));

		await expect(isRefusedForSignIn("bash", { tools: [tool(true)], getSession })).resolves.toBe(
			false,
		);
		await expect(
			isRefusedForSignIn(ENV_CREATE, { tools: [tool(false)], getSession }),
		).resolves.toBe(false);
		expect(getSession).not.toHaveBeenCalled();
	});
});
