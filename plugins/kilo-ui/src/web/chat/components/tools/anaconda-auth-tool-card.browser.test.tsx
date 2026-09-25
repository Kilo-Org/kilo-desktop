import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { FORCE_ANACONDA_SIGN_IN_GATE_FLAG, SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import type { AuthSession } from "@kilo-desktop/feature-sdk";

import { ToolCallFallback } from "./tool-ui-inline.js";

afterEach(cleanup);

describe("AnacondaAuthToolCard", () => {
	it("explains why Local Model Server requires sign-in and starts inline auth", async () => {
		const signIn = vi.fn(async () => true);
		const cancel = vi.fn();
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
		system.getSdk("local-inference").plugins.expose("authGate", { signIn, cancel });
		const { baseElement } = render(
			<SdkProvider system={system}>
				<ToolCallFallback
					type="tool-call"
					toolCallId="local-model-settings"
					toolName="desktop_local_inference_settings_open"
					args={{}}
					argsText="{}"
					status={{ type: "running" }}
					addResult={vi.fn()}
					resume={vi.fn()}
					respondToApproval={vi.fn()}
				/>
			</SdkProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("anaconda-auth-tool-card")).toBeVisible();
		await expect.element(screen.getByText("Sign in to view Local Model Server")).toBeVisible();
		await expect
			.element(screen.getByText(/local model catalog is provided by Anaconda/i))
			.toBeVisible();
		await screen.getByRole("button", { name: "Sign in to Anaconda" }).click();

		expect(signIn).toHaveBeenCalledOnce();
	});

	it("lets the user cancel an environment setup request inline", async () => {
		const signIn = vi.fn(async () => true);
		const cancel = vi.fn();
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
		system.getSdk("environments").plugins.expose("authGate", { signIn, cancel });
		const { baseElement } = render(
			<SdkProvider system={system}>
				<ToolCallFallback
					type="tool-call"
					toolCallId="environment-setup"
					toolName="desktop_environments_conda_setup_open"
					args={{}}
					argsText="{}"
					status={{ type: "running" }}
					addResult={vi.fn()}
					resume={vi.fn()}
					respondToApproval={vi.fn()}
				/>
			</SdkProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Sign in to use Conda Environments")).toBeVisible();
		await screen.getByRole("button", { name: "Cancel" }).click();

		expect(cancel).toHaveBeenCalledOnce();
		expect(signIn).not.toHaveBeenCalled();
	});

	it("reports a cancelled sign-in instead of claiming authentication completed", async () => {
		const sdk = createFakeSdk({ featureId: "kilo-ui" });
		const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
		system
			.getSdk("environments")
			.plugins.expose("authGate", { signIn: async () => true, cancel: () => undefined });
		const { baseElement } = render(
			<SdkProvider system={system}>
				<ToolCallFallback
					type="tool-call"
					toolCallId="environment-setup"
					toolName="desktop_environments_conda_setup_open"
					args={{}}
					argsText="{}"
					status={{ type: "incomplete", reason: "error" }}
					addResult={vi.fn()}
					resume={vi.fn()}
					respondToApproval={vi.fn()}
				/>
			</SdkProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(/the action did not run/i)).toBeVisible();
		await expect
			.element(screen.getByText("Anaconda authentication complete"))
			.not.toBeInTheDocument();
	});

	it("reports authentication complete only for completed tool calls", async () => {
		const session: AuthSession = { status: "authenticated", user: { username: "ada" } };
		const sdk = createFakeSdk({ featureId: "kilo-ui", auth: { peek: () => session } });
		const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
		const { baseElement } = render(
			<SdkProvider system={system}>
				<ToolCallFallback
					type="tool-call"
					toolCallId="environment-setup"
					toolName="desktop_environments_conda_setup_open"
					args={{}}
					argsText="{}"
					status={{ type: "complete" }}
					addResult={vi.fn()}
					resume={vi.fn()}
					respondToApproval={vi.fn()}
				/>
			</SdkProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Anaconda authentication complete")).toBeVisible();
	});

	it("stays on the sign-in card for authenticated users while the gate flag is forced", async () => {
		const session: AuthSession = { status: "authenticated", user: { username: "ada" } };
		const signIn = vi.fn(async () => true);
		const cancel = vi.fn();
		const sdk = createFakeSdk({
			featureId: "kilo-ui",
			auth: { peek: () => session },
			featureFlags: { peek: () => ({ [FORCE_ANACONDA_SIGN_IN_GATE_FLAG]: true }) },
		});
		const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
		system.getSdk("environments").plugins.expose("authGate", { signIn, cancel });
		const { baseElement } = render(
			<SdkProvider system={system}>
				<ToolCallFallback
					type="tool-call"
					toolCallId="environment-setup"
					toolName="desktop_environments_conda_setup_open"
					args={{}}
					argsText="{}"
					status={{ type: "running" }}
					addResult={vi.fn()}
					resume={vi.fn()}
					respondToApproval={vi.fn()}
				/>
			</SdkProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("anaconda-auth-tool-card")).toBeVisible();
		await expect.element(screen.getByText("Sign in to use Conda Environments")).toBeVisible();

		await screen.getByRole("button", { name: "Sign in to Anaconda" }).click();
		expect(signIn).toHaveBeenCalledOnce();
	});
});
