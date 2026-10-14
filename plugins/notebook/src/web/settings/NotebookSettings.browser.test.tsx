import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider, SettingsSectionProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { notebookContract, type NotebookSettings as Settings } from "../../contracts/schemas.js";
import { NotebookSettings } from "./NotebookSettings.js";

// Sessions are constants: peek/getSnapshot must be referentially stable or
// useSyncExternalStore loops.
const SIGNED_IN = { status: "authenticated", user: { email: "ada@example.com" } } as const;
const SIGNED_OUT = { status: "anonymous" } as const;

function renderSettings(
	initial: Settings = { autoCreateEnvironmentFile: true, trustNewNotebooks: false },
	{ session = SIGNED_IN }: { session?: typeof SIGNED_IN | typeof SIGNED_OUT } = {},
) {
	let settings = initial;
	const updateSettings = vi.fn(
		async (patch: { [K in keyof Settings]?: Settings[K] | undefined }) => {
			settings = {
				autoCreateEnvironmentFile:
					patch.autoCreateEnvironmentFile ?? settings.autoCreateEnvironmentFile,
				trustNewNotebooks: patch.trustNewNotebooks ?? settings.trustNewNotebooks,
			};
			return settings;
		},
	);
	const sdk = createFakeSdk({
		featureId: "notebook",
		auth: {
			subscribe: (fn) => {
				fn(session);
				return () => undefined;
			},
			peek: () => session,
			getSession: async () => session,
		},
		channels: notebookContract,
		handlers: { getSettings: async () => settings, updateSettings },
	});
	const system = createFakeFeatureSystem({ sdks: { notebook: sdk } });
	const signIn = vi.fn(async () => true);
	system.getSdk("kilo-ui").plugins.expose("signIn", { signIn });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { baseElement } = render(
		<QueryClientProvider client={client}>
			<SdkProvider system={system}>
				<SettingsSectionProvider
					value={{ title: "Notebooks", description: "Notebook preferences." }}
				>
					<NotebookSettings />
				</SettingsSectionProvider>
			</SdkProvider>
		</QueryClientProvider>,
	);
	return { screen: page.elementLocator(baseElement), updateSettings, signIn };
}

afterEach(() => cleanup());

describe("NotebookSettings", () => {
	it("shows both settings with their defaults", async () => {
		const { screen } = renderSettings();

		await expect.element(screen.getByRole("heading", { name: "Notebooks" })).toBeVisible();
		await expect
			.element(screen.getByRole("switch", { name: "Automatically create environment.yml" }))
			.toBeChecked();
		await expect
			.element(screen.getByRole("switch", { name: "Trust new notebooks" }))
			.not.toBeChecked();
	});

	it("asks a signed-out user to sign in instead of showing the settings", async () => {
		const { screen, signIn } = renderSettings(undefined, { session: SIGNED_OUT });

		await expect.element(screen.getByTestId("kilo-auth-gate-signin")).toBeVisible();
		await expect
			.element(screen.getByText("Notebooks requires a Kilo account. Sign in to continue."))
			.toBeVisible();
		await expect
			.element(screen.getByRole("switch", { name: "Trust new notebooks" }))
			.not.toBeInTheDocument();

		await screen.getByTestId("kilo-auth-gate-sign-in-button").click();
		expect(signIn).toHaveBeenCalledOnce();
	});

	it("saves each toggle as its own setting", async () => {
		const { screen, updateSettings } = renderSettings();

		await screen.getByRole("switch", { name: "Trust new notebooks" }).click();
		await expect.poll(() => updateSettings.mock.calls[0]?.[0]).toEqual({ trustNewNotebooks: true });
		await expect.element(screen.getByRole("switch", { name: "Trust new notebooks" })).toBeChecked();

		await screen.getByRole("switch", { name: "Automatically create environment.yml" }).click();
		await expect
			.poll(() => updateSettings.mock.calls[1]?.[0])
			.toEqual({ autoCreateEnvironmentFile: false });
	});
});
