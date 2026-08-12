import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import {
	anacondaMcpContract,
	type AnacondaMcpSettings,
	type AnacondaMcpStatus,
} from "@anaconda-agentic-desktop/contracts";
import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import type { ChannelHandlerMap } from "@anaconda-agentic-desktop/feature-sdk";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { AnacondaMcpSettings as SettingsPanel } from "./AnacondaMcpSettings";

type Handlers = ChannelHandlerMap<typeof anacondaMcpContract>;

interface SettingsSetInput {
	enabled?: boolean | undefined;
	urlOverride?: string | null | undefined;
}

function testClient(): QueryClient {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function createHandlers(
	overrides: {
		status?: AnacondaMcpStatus;
		settings?: AnacondaMcpSettings;
		onSettingsSet?: (input: SettingsSetInput) => void;
	} = {},
): Handlers {
	const status: AnacondaMcpStatus = overrides.status ?? {
		state: "connected",
		url: "https://anaconda.com/api/mcp",
	};
	let settings: AnacondaMcpSettings = overrides.settings ?? { enabled: true, urlOverride: null };

	return {
		"status.get": () => status,
		"settings.get": () => settings,
		"settings.set": (input) => {
			if (input.enabled !== undefined) settings = { ...settings, enabled: input.enabled };
			if (input.urlOverride !== undefined)
				settings = { ...settings, urlOverride: input.urlOverride };
			overrides.onSettingsSet?.(input);
			return { ok: true as const };
		},
	};
}

function renderSettings(handlers: Handlers, options: { flagEnabled?: boolean } = {}) {
	const flagEnabled = options.flagEnabled ?? true;
	const flags: Record<string, unknown> = { "remote-anaconda-mcp": flagEnabled };
	const sdk = createFakeSdk({
		featureId: "anaconda-mcp",
		channels: anacondaMcpContract,
		handlers,
		featureFlags: {
			getAllFlags: async () => flags,
			subscribe: (fn) => {
				fn(flags);
				return () => {};
			},
			peek: () => flags,
		},
	});
	const system = createFakeFeatureSystem({ sdks: { "anaconda-mcp": sdk } });
	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={testClient()}>
				<SettingsPanel />
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(() => {
	cleanup();
});

describe("AnacondaMcpSettings", () => {
	it("shows connected status chip when connected", async () => {
		const { baseElement } = renderSettings(
			createHandlers({ status: { state: "connected", url: "https://anaconda.com/api/mcp" } }),
		);
		const screen = page.elementLocator(baseElement);

		const chip = screen.getByTestId("anaconda-mcp-status-chip");
		await expect.element(chip).toBeVisible();
		await expect.element(chip).toHaveAttribute("data-state", "connected");
	});

	it("shows waiting-for-auth status when not logged in", async () => {
		const { baseElement } = renderSettings(
			createHandlers({ status: { state: "waiting-for-auth" } }),
		);
		const screen = page.elementLocator(baseElement);

		const chip = screen.getByTestId("anaconda-mcp-status-chip");
		await expect.element(chip).toHaveAttribute("data-state", "waiting-for-auth");
	});

	it("shows disabled status when feature is disabled", async () => {
		const { baseElement } = renderSettings(createHandlers({ status: { state: "disabled" } }));
		const screen = page.elementLocator(baseElement);

		const chip = screen.getByTestId("anaconda-mcp-status-chip");
		await expect.element(chip).toHaveAttribute("data-state", "disabled");
	});

	it("shows error status with reason", async () => {
		const { baseElement } = renderSettings(
			createHandlers({ status: { state: "error", reason: "Connection refused" } }),
		);
		const screen = page.elementLocator(baseElement);

		const chip = screen.getByTestId("anaconda-mcp-status-chip");
		await expect.element(chip).toHaveAttribute("data-state", "error");
	});

	it("shows waiting-for-kilo status", async () => {
		const { baseElement } = renderSettings(
			createHandlers({ status: { state: "waiting-for-kilo" } }),
		);
		const screen = page.elementLocator(baseElement);

		const chip = screen.getByTestId("anaconda-mcp-status-chip");
		await expect.element(chip).toHaveAttribute("data-state", "waiting-for-kilo");
	});

	it("toggle calls settings.set with enabled: false", async () => {
		let lastSet: SettingsSetInput | undefined;
		const { baseElement } = renderSettings(
			createHandlers({
				settings: { enabled: true, urlOverride: null },
				onSettingsSet: (input) => {
					lastSet = input;
				},
			}),
		);
		const screen = page.elementLocator(baseElement);

		const toggle = screen.getByTestId("anaconda-mcp-toggle");
		await expect.element(toggle).toBeVisible();
		await toggle.click();

		expect(lastSet).toEqual({ enabled: false });
	});

	it("toggle calls settings.set with enabled: true when disabled", async () => {
		let lastSet: SettingsSetInput | undefined;
		const { baseElement } = renderSettings(
			createHandlers({
				settings: { enabled: false, urlOverride: null },
				onSettingsSet: (input) => {
					lastSet = input;
				},
			}),
		);
		const screen = page.elementLocator(baseElement);

		const toggle = screen.getByTestId("anaconda-mcp-toggle");
		await toggle.click();

		expect(lastSet).toEqual({ enabled: true });
	});

	it("shows advanced section with URL override input on click", async () => {
		const { baseElement } = renderSettings(createHandlers());
		const screen = page.elementLocator(baseElement);

		// Advanced section is hidden initially
		await expect.element(screen.getByTestId("anaconda-mcp-url-input")).not.toBeInTheDocument();

		// Click to expand
		await screen.getByTestId("anaconda-mcp-advanced-toggle").click();
		await expect.element(screen.getByTestId("anaconda-mcp-url-input")).toBeVisible();
	});

	it("submitting URL override calls settings.set", async () => {
		let lastSet: SettingsSetInput | undefined;
		const { baseElement } = renderSettings(
			createHandlers({
				onSettingsSet: (input) => {
					lastSet = input;
				},
			}),
		);
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("anaconda-mcp-advanced-toggle").click();
		await screen.getByTestId("anaconda-mcp-url-input").fill("https://custom.example.com/mcp");
		await screen.getByTestId("anaconda-mcp-url-save").click();

		expect(lastSet).toEqual({ urlOverride: "https://custom.example.com/mcp" });
	});

	it("reset button clears URL override", async () => {
		let lastSet: SettingsSetInput | undefined;
		const { baseElement } = renderSettings(
			createHandlers({
				settings: { enabled: true, urlOverride: "https://custom.example.com/mcp" },
				onSettingsSet: (input) => {
					lastSet = input;
				},
			}),
		);
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("anaconda-mcp-advanced-toggle").click();
		await screen.getByTestId("anaconda-mcp-url-clear").click();

		expect(lastSet).toEqual({ urlOverride: null });
	});
	describe("feature flag gate (remote-anaconda-mcp)", () => {
		it("renders the not-available message when the flag is off", async () => {
			const { baseElement } = renderSettings(createHandlers(), { flagEnabled: false });
			const screen = page.elementLocator(baseElement);

			const root = screen.getByTestId("anaconda-mcp-settings");
			await expect.element(root).toHaveAttribute("data-state", "flag-off");

			// None of the interactive controls should render in flag-off state.
			await expect.element(screen.getByTestId("anaconda-mcp-toggle")).not.toBeInTheDocument();
			await expect.element(screen.getByTestId("anaconda-mcp-status-chip")).not.toBeInTheDocument();
			await expect
				.element(screen.getByTestId("anaconda-mcp-advanced-toggle"))
				.not.toBeInTheDocument();
		});

		it("renders the normal panel when the flag is on", async () => {
			const { baseElement } = renderSettings(createHandlers(), { flagEnabled: true });
			const screen = page.elementLocator(baseElement);

			await expect.element(screen.getByTestId("anaconda-mcp-toggle")).toBeVisible();
			await expect.element(screen.getByTestId("anaconda-mcp-status-chip")).toBeVisible();
		});
	});
});
