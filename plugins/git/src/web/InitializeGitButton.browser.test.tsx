import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { FeatureError } from "@kilo-desktop/feature-sdk";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";

import { gitContract } from "../contracts/schemas.js";
import { InitializeGitButton } from "./InitializeGitButton.js";

const toastApi = vi.hoisted(() => ({
	error: vi.fn(),
}));

vi.mock("@kilo-desktop/ui/components/sonner", () => ({
	toast: toastApi,
}));

function renderButton(
	handlers: {
		init?: (input: { workingDirectory: string }) => Promise<void> | void;
	},
	options?: { size?: "sm" | "xs"; testId?: string },
) {
	const sdk = createFakeSdk({ featureId: "git" });
	const mainSdk = createFakeMainSdk({ featureId: "git", services: sdk.services });
	mainSdk.channels(gitContract).handleAll({
		init: async (input) => {
			await handlers.init?.(input);
			return undefined;
		},
		repositoryType: () => {
			throw new Error("unused in this test");
		},
		status: () => {
			throw new Error("unused in this test");
		},
		available: () => true,
		checkout: () => {
			throw new Error("unused in this test");
		},
		branches: () => {
			throw new Error("unused in this test");
		},
		getDiffContents: () => {
			throw new Error("unused in this test");
		},
		defaultBranch: () => {
			throw new Error("unused in this test");
		},
	});
	const system = createFakeFeatureSystem({ sdks: { git: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	const testId = options?.testId ?? "git-init-draft-button";
	const button = page.getByTestId(testId);
	const result = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<InitializeGitButton
					workspaceDirectory="/repo/project"
					size={options?.size ?? "sm"}
					testId={testId}
				/>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { ...result, button };
}

afterEach(() => {
	cleanup();
	toastApi.error.mockReset();
});

describe("InitializeGitButton", () => {
	it("initializes the workspace directory on click", async () => {
		const init = vi.fn(async () => undefined);
		const { button } = renderButton({ init });

		await button.click();

		await vi.waitFor(() => {
			expect(init).toHaveBeenCalledWith({ workingDirectory: "/repo/project" });
		});
	});

	it("disables the button and shows a spinner while init is pending", async () => {
		let finishInit: (() => void) | undefined;
		const init = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishInit = resolve;
				}),
		);
		const { button } = renderButton({ init });

		await button.click();

		await expect.element(button).toBeDisabled();
		await expect
			.element(button.element().querySelector('[data-slot="spinner"]') as SVGElement | null)
			.toBeVisible();

		finishInit?.();
		await vi.waitFor(() => {
			expect(init).toHaveBeenCalled();
		});
	});

	it("surfaces a failed init as an error toast", async () => {
		const { button } = renderButton({
			init: () => Promise.reject(new FeatureError("Git executable not found.", "BUSINESS")),
		});

		await button.click();

		await vi.waitFor(() => {
			expect(toastApi.error).toHaveBeenCalledWith("Could not initialize git", {
				description: "Git executable not found.",
			});
		});
		// The failed init changed nothing: the button stays.
		await expect.element(button).toBeVisible();
		await expect.element(button).toBeEnabled();
	});

	it("renders the thread-footer variant under its own test id", async () => {
		const { button } = renderButton({}, { size: "xs", testId: "git-init-thread-button" });

		await expect.element(button).toBeVisible();
	});
});
