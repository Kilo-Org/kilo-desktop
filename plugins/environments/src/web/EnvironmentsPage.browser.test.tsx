import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { CondaStatus } from "../contracts/index";
import {
	renderWithConda,
	SIGNED_IN,
	SIGNED_OUT,
	type EnvironmentsHostOptions,
} from "../test/environments-host";
import type { CondaClient } from "./conda";
import { EnvironmentsPage } from "./EnvironmentsPage";

/**
 * Render the settings page on a kernel with `kilo.environments/conda` in the
 * given status (default ready), signed in to Kilo, listing `list`.
 */
function renderPage(
	options: {
		status?: CondaStatus;
		identity?: EnvironmentsHostOptions["identity"];
		list?: CondaClient["listEnvironments"];
		/** Height of the surrounding shell; settings renders the page in a bounded scroller. */
		hostHeight?: number;
	} = {},
) {
	const hostOptions: EnvironmentsHostOptions = {
		status: options.status ?? "ready",
		identity: options.identity ?? SIGNED_IN,
		handlers: { listEnvironments: options.list ?? (async () => []) },
	};
	if (options.hostHeight === undefined) return renderWithConda(<EnvironmentsPage />, hostOptions);

	// Mirrors the settings content area: a bounded, scrollable flex column that is
	// the page's direct parent, as the shell arranges it in production.
	return renderWithConda(
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
			<EnvironmentsPage />
		</div>,
		hostOptions,
	);
}

afterEach(() => {
	cleanup();
});

describe("EnvironmentsPage", () => {
	it("renders the Conda section", async () => {
		const { baseElement } = await renderPage({ list: async () => [] });
		const screen = page.elementLocator(baseElement);

		// The provider section carries an accessible name even though a single
		// provider ships no visible sub-heading.
		await expect.element(screen.getByRole("region", { name: "Conda" })).toBeInTheDocument();
	});

	it("renders the empty state when no envs are reported", async () => {
		const { baseElement } = await renderPage({ list: async () => [] });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(/no conda environments found/i)).toBeVisible();
	});

	it("renders envs — nameless envs show their directory and named envs show their name + prefix", async () => {
		const { baseElement } = await renderPage({
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
		const { baseElement } = await renderPage({ list: () => pending });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(/loading environments/i)).toBeVisible();
		resolve?.([]);
	});

	it("surfaces backend errors", async () => {
		const { baseElement } = await renderPage({
			list: async () => {
				throw new Error("boom");
			},
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText(/could not load environments/i)).toBeVisible();
	});

	describe("feature flag gate (environments-feature)", () => {
		it("renders the not-available message when the flag is off", async () => {
			const { baseElement } = await renderPage({ status: "disabled" });
			const screen = page.elementLocator(baseElement);

			const root = screen.getByTestId("environments-page");
			await expect.element(root).toHaveAttribute("data-state", "flag-off");

			await expect.element(screen.getByTestId("environments-flag-off-message")).toBeVisible();
		});

		it("renders the conda panel when the flag is on", async () => {
			const { baseElement } = await renderPage({ status: "ready" });
			const screen = page.elementLocator(baseElement);

			const root = screen.getByTestId("environments-page");
			await expect.element(root).not.toHaveAttribute("data-state", "flag-off");
			await expect
				.element(screen.getByTestId("environments-flag-off-message"))
				.not.toBeInTheDocument();
		});
	});

	describe("Kilo sign-in gate", () => {
		it("asks a signed-out person to sign in instead of showing the page", async () => {
			const { baseElement } = await renderPage({ identity: SIGNED_OUT });
			const screen = page.elementLocator(baseElement);

			await expect.element(screen.getByTestId("kilo-auth-gate-signin")).toBeVisible();
			await expect
				.element(screen.getByText(/Conda Environments requires a Kilo account/))
				.toBeVisible();
			await expect.element(screen.getByTestId("environments-page")).not.toBeInTheDocument();
		});

		it("does not ask to sign in while the feature is off", async () => {
			const { baseElement } = await renderPage({ status: "disabled", identity: SIGNED_OUT });
			const screen = page.elementLocator(baseElement);

			await expect.element(screen.getByTestId("environments-flag-off-message")).toBeVisible();
			await expect.element(screen.getByTestId("kilo-auth-gate-signin")).not.toBeInTheDocument();
		});
	});

	describe("provider boot status gate", () => {
		it("renders unavailable message when providers failed to boot", async () => {
			const { baseElement } = await renderPage({ status: "unavailable" });
			const screen = page.elementLocator(baseElement);

			const root = screen.getByTestId("environments-page");
			await expect.element(root).toHaveAttribute("data-state", "unavailable");

			await expect.element(screen.getByTestId("environments-unavailable-message")).toBeVisible();
		});

		it("shows a loading skeleton while sign-in is not yet known", async () => {
			const { baseElement } = await renderPage({ identity: { ...SIGNED_IN, signedIn: null } });
			const screen = page.elementLocator(baseElement);

			await expect
				.element(screen.getByTestId("environments-page"))
				.toHaveAttribute("data-state", "loading");
			await expect
				.element(screen.getByRole("status", { name: "Loading environments" }))
				.toBeVisible();
		});

		it("renders normally when providers are available", async () => {
			const { baseElement } = await renderPage({ status: "ready" });
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

	it("scrolls the settings page, not the environment list", async () => {
		const { baseElement } = await renderPage({
			list: async () => manyEnvironments,
			hostHeight: 420,
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();

		const shell = baseElement.querySelector('[data-qa-id="test-settings-scroller"]')!;
		const list = baseElement.querySelector('[data-qa-id="environments-conda-list"]')!;

		expect(shell.scrollHeight).toBeGreaterThan(shell.clientHeight);
		expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight + 1);
	});
});
