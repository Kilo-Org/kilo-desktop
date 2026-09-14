import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";
import { SidebarProvider } from "@anaconda-agentic-desktop/ui/components/sidebar";

import { condaContract, type CondaService } from "../contracts/providers/conda.js";
import { environmentsStatusContract } from "../contracts/status.js";
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
		providersAvailable?: boolean;
		list?: CondaService["conda.envs.list"];
		/** Height of the surrounding shell; settings renders the page in a bounded scroller. */
		hostHeight?: number;
	} = {},
) {
	const flagEnabled = options.flagEnabled ?? true;
	const providersAvailable = options.providersAvailable ?? true;
	const list = options.list ?? (async () => []);
	const flags: Record<string, unknown> = { "environments-feature": flagEnabled };
	const sdk = createFakeSdk({
		featureId: "environments",
		channels: { ...condaContract, ...environmentsStatusContract },
		handlers: {
			"environments.status": async () => ({ providersAvailable }),
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

	const page = (
		<SdkProvider system={system}>
			<SidebarProvider>
				<QueryClientProvider client={queryClient}>
					<EnvironmentsPage />
				</QueryClientProvider>
			</SidebarProvider>
		</SdkProvider>
	);

	if (options.hostHeight === undefined) return render(page);

	// Mirrors the settings content area: a bounded, scrollable flex column that is
	// the page's direct parent, as the shell arranges it in production.
	return render(
		<SdkProvider system={system}>
			<SidebarProvider>
				<div
					style={{
						height: `${options.hostHeight}px`,
						display: "flex",
						flexDirection: "column",
						minHeight: 0,
						overflowY: "auto",
					}}
					data-qa-id="test-settings-scroller"
				>
					<QueryClientProvider client={queryClient}>
						<EnvironmentsPage />
					</QueryClientProvider>
				</div>
			</SidebarProvider>
		</SdkProvider>,
	);
}

afterEach(() => {
	cleanup();
});

describe("EnvironmentsPage", () => {
	it("renders the Conda section", async () => {
		const { baseElement } = renderPage({ list: async () => [] });
		const screen = page.elementLocator(baseElement);

		// The provider section carries an accessible name even though a single
		// provider ships no visible sub-heading.
		await expect.element(screen.getByRole("region", { name: "Conda" })).toBeInTheDocument();
	});

	it("renders the empty state when no envs are reported", async () => {
		const { baseElement } = renderPage({ list: async () => [] });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(/no conda environments found/i)).toBeVisible();
	});

	it("renders envs — nameless envs show their directory and named envs show their name + prefix", async () => {
		const { baseElement } = renderPage({
			list: async () => [
				{ name: "", prefix: "/opt/conda" },
				{ name: "dev", prefix: "/opt/conda/envs/dev" },
			],
		});
		const screen = page.elementLocator(baseElement);

		// Nameless envs display their directory basename ("conda"), not "base".
		await expect.element(screen.getByText("conda")).toBeVisible();
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

	describe("provider boot status gate", () => {
		it("renders unavailable message when providers failed to boot", async () => {
			const { baseElement } = renderPage({ providersAvailable: false });
			const screen = page.elementLocator(baseElement);

			const root = screen.getByTestId("environments-page");
			await expect.element(root).toHaveAttribute("data-state", "unavailable");

			await expect.element(screen.getByTestId("environments-unavailable-message")).toBeVisible();
		});

		it("renders normally when providers are available", async () => {
			const { baseElement } = renderPage({ providersAvailable: true });
			const screen = page.elementLocator(baseElement);

			await expect
				.element(screen.getByTestId("environments-unavailable-message"))
				.not.toBeInTheDocument();
			await expect.element(screen.getByRole("region", { name: "Conda" })).toBeInTheDocument();
		});
	});
});

describe("EnvironmentsPage — scrolling", () => {
	const manyEnvironments = Array.from({ length: 15 }, (_, index) => ({
		name: `env-${String(index).padStart(2, "0")}`,
		prefix: `/opt/conda/envs/env-${index}`,
	}));

	it("keeps the page chrome in place and scrolls only the environment list", async () => {
		const { baseElement } = renderPage({
			list: async () => manyEnvironments,
			hostHeight: 420,
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();

		const shell = baseElement.querySelector('[data-qa-id="test-settings-scroller"]')!;
		const table = baseElement.querySelector("table")!;
		const listScroller = table.parentElement!;

		// The settings shell must not be what overflows: the list owns the scroll.
		expect(shell.scrollHeight).toBeLessThanOrEqual(shell.clientHeight + 1);
		expect(listScroller.scrollHeight).toBeGreaterThan(listScroller.clientHeight);
	});
});
