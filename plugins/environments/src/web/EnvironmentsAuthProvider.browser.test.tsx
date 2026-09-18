import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import type { AuthSession } from "@kilo-desktop/feature-sdk";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { EnvironmentsAuthProvider } from "./EnvironmentsAuthProvider.js";
import { webRegister } from "./index.js";

afterEach(cleanup);

describe("EnvironmentsAuthProvider", () => {
	it("shows sign-in and resumes chat-triggered setup navigation", async () => {
		let session: AuthSession = { status: "anonymous" };
		const listeners = new Set<(next: AuthSession) => void>();
		const navigate = vi.fn();
		const login = vi.fn(async (): Promise<AuthSession> => {
			session = { status: "authenticated", user: { username: "ada" } };
			for (const listener of listeners) listener(session);
			return session;
		});
		const sdk = createFakeSdk({
			featureId: "environments",
			auth: {
				subscribe(listener) {
					listeners.add(listener);
					listener(session);
					return () => listeners.delete(listener);
				},
				peek: () => session,
				login,
			},
			navigation: { navigate },
		});
		webRegister(sdk);
		const system = createFakeFeatureSystem({ sdks: { environments: sdk } });
		render(
			<SdkProvider system={system}>
				<EnvironmentsAuthProvider>App</EnvironmentsAuthProvider>
			</SdkProvider>,
		);

		const invocation = sdk.services.toolRegistry.invoke("environments", "conda.setup.open", {});
		expect(navigate).not.toHaveBeenCalled();

		const gate = sdk.plugins.get<{ authGate: { signIn(): Promise<boolean> } }>(
			"environments",
		)?.authGate;
		await gate?.signIn();
		await expect.poll(() => navigate).toHaveBeenCalledWith("/settings/environments", undefined);
		await expect(invocation).resolves.toEqual({ opened: true });
	});
});
