import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { condaContract, type CondaService } from "../contracts/providers/conda.js";
import { EnvironmentsPage } from "./EnvironmentsPage";

/**
 * Render the plugin page against a fake feature system with:
 * - a configurable `environments-feature` LaunchDarkly flag (defaults to on)
 * - a `conda.envs.list` handler returning injected data
 *
 * The provider chain (`SdkProvider` + `QueryClientProvider`) mirrors what
 * the shell wires in production; without it `useSdk` / `useSdkQuery` /
 * `useFeatureFlag` throw.
 */
function renderPage(
	options: {
		flagEnabled?: boolean;
		list?: CondaService["conda.envs.list"];
	} = {},
) {
	const flagEnabled = options.flagEnabled ?? true;
	const list = options.list ?? (async () => []);
	const flags: Record<string, unknown> = { "environments-feature": flagEnabled };
	const sdk = createFakeSdk({
		featureId: "environments",
		channels: condaContract,
		handlers: {
			"conda.envs.list": list,
			"conda.envs.create": async () => {
				throw new Error("not implemented in test");
			},
			"conda.envs.delete": async () => {
				throw new Error("not implemented in test");
			},
			"conda.packages.list": async () => {
				throw new Error("not implemented in test");
			},
			"conda.packages.install": async () => {
				throw new Error("not implemented in test");
			},
			"conda.packages.remove": async () => {
				throw new Error("not implemented in test");
			},
			"conda.channels.list": async () => {
				throw new Error("not implemented in test");
			},
			"conda.channels.add": async () => {
				throw new Error("not implemented in test");
			},
			"conda.channels.remove": async () => {
				throw new Error("not implemented in test");
			},
			"conda.jobs.cancel": async () => {
				throw new Error("not implemented in test");
			},
		},
		featureFlags: {
			getAllFlags: async () => flags,
			subscribe: (fn) => {
				fn(flags);
				return () => {};
			},
			peek: () => flags,
		},
	});
	const system = createFakeFeatureSystem({ sdks: { environments: sdk } });
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<EnvironmentsPage />
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(() => {
	cleanup();
});

describe("EnvironmentsPage", () => {
	it("renders the heading and the Conda section", async () => {
		const { baseElement } = renderPage({ list: async () => [] });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("heading", { name: "Environments" })).toBeVisible();
		await expect.element(screen.getByRole("heading", { name: "Conda" })).toBeVisible();
	});

	it("renders the empty state when no envs are reported", async () => {
		const { baseElement } = renderPage({ list: async () => [] });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(/no conda environments found/i)).toBeVisible();
	});

	it("renders envs — base surfaces as 'base' and named envs surface with their name + prefix", async () => {
		const { baseElement } = renderPage({
			list: async () => [
				{ name: "", prefix: "/opt/conda" },
				{ name: "dev", prefix: "/opt/conda/envs/dev" },
			],
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("base")).toBeVisible();
		await expect.element(screen.getByText("dev")).toBeVisible();
		await expect.element(screen.getByText("/opt/conda/envs/dev")).toBeVisible();
	});

	it("shows a loading state before the query resolves", async () => {
		let resolve: ((envs: never[]) => void) | undefined;
		const pending = new Promise<never[]>((r) => {
			resolve = r;
		});
		const { baseElement } = renderPage({ list: () => pending });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(/loading environments/i)).toBeVisible();
		resolve?.([]);
	});

	it("surfaces backend errors", async () => {
		const { baseElement } = renderPage({
			list: async () => {
				throw new Error("boom");
			},
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(/could not load environments/i)).toBeVisible();
	});

	describe("feature flag gate (environments-feature)", () => {
		it("renders the not-available message when the flag is off", async () => {
			const { baseElement } = renderPage({ flagEnabled: false });
			const screen = page.elementLocator(baseElement);

			const root = screen.getByTestId("environments-page");
			await expect.element(root).toHaveAttribute("data-state", "flag-off");

			await expect.element(screen.getByTestId("environments-flag-off-message")).toBeVisible();
		});

		it("renders the conda panel when the flag is on", async () => {
			const { baseElement } = renderPage({ flagEnabled: true });
			const screen = page.elementLocator(baseElement);

			const root = screen.getByTestId("environments-page");
			await expect.element(root).not.toHaveAttribute("data-state", "flag-off");
			await expect
				.element(screen.getByTestId("environments-flag-off-message"))
				.not.toBeInTheDocument();
		});
	});
});
