import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider, SettingsSectionProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import {
	EXTERNAL_CLIENTS_CHANGED_EVENT,
	kiloServerContract,
	type ExternalClientsState,
} from "../../contracts/schemas.js";
import { ExternalAiAppsSettings } from "./ExternalAiAppsSettings.js";

const DEFAULT_PORT = 9350;

function initialState(overrides: Partial<ExternalClientsState> = {}): ExternalClientsState {
	return {
		enabled: false,
		port: DEFAULT_PORT,
		defaultPort: DEFAULT_PORT,
		status: { status: "stopped" },
		clients: [],
		...overrides,
	};
}

function renderSettings(initial: ExternalClientsState = initialState()) {
	let state = initial;
	const running = (port: number) => ({
		status: "running" as const,
		url: `http://127.0.0.1:${port}/mcp`,
	});
	const handlers = {
		"externalClients.getState": vi.fn(async () => state),
		"externalClients.setEnabled": vi.fn(async ({ enabled }: { enabled: boolean }) => {
			state = {
				...state,
				enabled,
				status: enabled ? running(state.port) : { status: "stopped" },
			};
			return state;
		}),
		"externalClients.setPort": vi.fn(async ({ port }: { port: number | null }) => {
			const next = port ?? state.defaultPort;
			state = { ...state, port: next, ...(state.enabled ? { status: running(next) } : {}) };
			return state;
		}),
		"externalClients.createClient": vi.fn(async ({ name }: { name: string }) => {
			const client = { id: `id-${name}`, name, createdAt: "2026-10-07T12:00:00.000Z" };
			state = { ...state, clients: [...state.clients, client] };
			return { client, token: "secret-token-123", state };
		}),
		"externalClients.revokeClient": vi.fn(async ({ id }: { id: string }) => {
			state = { ...state, clients: state.clients.filter((client) => client.id !== id) };
			return state;
		}),
	};
	const sdk = createFakeSdk({
		featureId: "kilo-server",
		channels: kiloServerContract,
		handlers: handlers as never,
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-server": sdk } });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { baseElement } = render(
		<QueryClientProvider client={client}>
			<SdkProvider system={system}>
				<SettingsSectionProvider
					value={{ title: "External AI apps", description: "Let other apps use the tools." }}
				>
					<ExternalAiAppsSettings />
				</SettingsSectionProvider>
			</SdkProvider>
		</QueryClientProvider>,
	);
	return { screen: page.elementLocator(baseElement), handlers, sdk };
}

afterEach(() => cleanup());

describe("ExternalAiAppsSettings", () => {
	it("starts switched off with no paired apps", async () => {
		const { screen } = renderSettings();

		await expect.element(screen.getByRole("heading", { name: "External AI apps" })).toBeVisible();
		await expect
			.element(screen.getByRole("switch", { name: "Allow external AI apps" }))
			.not.toBeChecked();
		await expect.element(screen.getByTestId("external-ai-apps-status")).toHaveTextContent("Off");
		await expect.element(screen.getByText("No apps paired yet.")).toBeVisible();
	});

	it("turns the endpoint on and shows where it listens", async () => {
		const { screen, handlers } = renderSettings();

		await screen.getByRole("switch", { name: "Allow external AI apps" }).click();

		await expect
			.poll(() => handlers["externalClients.setEnabled"].mock.calls[0]?.[0])
			.toEqual({
				enabled: true,
			});
		await expect
			.element(screen.getByTestId("external-ai-apps-status"))
			.toMatchTextContent(/http:\/\/127\.0\.0\.1:9350\/mcp/);
	});

	it("pairs an app and shows its token once with generic setup instructions", async () => {
		const { screen, handlers } = renderSettings(initialState({ enabled: true }));

		await screen.getByTestId("external-ai-apps-client-name").fill("Cursor on this Mac");
		await screen.getByTestId("external-ai-apps-pair").click();

		await expect
			.poll(() => handlers["externalClients.createClient"].mock.calls[0]?.[0])
			.toEqual({ name: "Cursor on this Mac" });
		const dialog = screen.getByTestId("external-client-token-dialog");
		await expect.element(dialog).toBeVisible();
		await expect
			.element(dialog.getByTestId("external-client-token"))
			.toMatchTextContent(/secret-token-123/);
		await expect
			.element(dialog.getByTestId("external-client-setup"))
			.toMatchTextContent(/Transport: Streamable HTTP/);
		await expect
			.element(dialog.getByTestId("external-client-setup"))
			.toMatchTextContent(/Authorization: Bearer secret-token-123/);
		await expect.element(dialog.getByText("mcpServers")).not.toBeInTheDocument();

		await dialog.getByTestId("external-client-token-done").click();

		await expect
			.element(screen.getByTestId("external-client-token-dialog"))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("external-ai-apps-clients"))
			.toMatchTextContent(/Cursor on this Mac/);
		await expect.element(screen.getByText("secret-token-123")).not.toBeInTheDocument();
	});

	it("shows only the configuration for the client the user picks", async () => {
		const { screen } = renderSettings(initialState({ enabled: true }));
		await screen.getByTestId("external-ai-apps-client-name").fill("Codex");
		await screen.getByTestId("external-ai-apps-pair").click();
		const dialog = screen.getByTestId("external-client-token-dialog");

		await dialog.getByTestId("external-client-kind").click();
		await screen.getByRole("option", { name: "Codex" }).click();

		await expect
			.element(dialog.getByTestId("external-client-setup"))
			.toMatchTextContent(/\[mcp_servers\.kilo-desktop\]/);
		await expect
			.element(dialog.getByTestId("external-client-setup-description"))
			.toMatchTextContent(/~\/\.codex\/config\.toml/);
		await expect
			.element(dialog.getByTestId("external-client-setup"))
			.not.toMatchTextContent(/Transport: Streamable HTTP/);
	});

	it("lets users pair apps only while external AI apps are allowed", async () => {
		const { screen } = renderSettings();

		await expect.element(screen.getByTestId("external-ai-apps-client-name")).toBeDisabled();
		await expect.element(screen.getByTestId("external-ai-apps-pair")).toBeDisabled();
		await expect
			.element(screen.getByTestId("external-ai-apps-pair-hint"))
			.toHaveTextContent("Turn on Allow external AI apps to pair an app.");

		await screen.getByRole("switch", { name: "Allow external AI apps" }).click();

		await expect.element(screen.getByTestId("external-ai-apps-client-name")).toBeEnabled();
		await expect.element(screen.getByTestId("external-ai-apps-pair-hint")).not.toBeInTheDocument();
	});

	it("removes a paired app after the user confirms", async () => {
		const { screen, handlers } = renderSettings(
			initialState({
				clients: [{ id: "cursor", name: "Cursor", createdAt: "2026-10-07T12:00:00.000Z" }],
			}),
		);

		await screen.getByRole("button", { name: "Remove Cursor" }).click();
		const dialog = screen.getByTestId("external-client-remove-dialog");
		await expect.element(dialog).toMatchTextContent(/Remove Cursor\?/);
		expect(handlers["externalClients.revokeClient"]).not.toHaveBeenCalled();

		await dialog.getByTestId("external-client-remove-confirm").click();

		await expect
			.poll(() => handlers["externalClients.revokeClient"].mock.calls[0]?.[0])
			.toEqual({ id: "cursor" });
		await expect.element(screen.getByText("No apps paired yet.")).toBeVisible();
	});

	it("keeps a paired app when the user cancels removal", async () => {
		const { screen, handlers } = renderSettings(
			initialState({
				clients: [{ id: "cursor", name: "Cursor", createdAt: "2026-10-07T12:00:00.000Z" }],
			}),
		);

		await screen.getByRole("button", { name: "Remove Cursor" }).click();
		await screen
			.getByTestId("external-client-remove-dialog")
			.getByRole("button", { name: "Cancel" })
			.click();

		await expect
			.element(screen.getByTestId("external-client-remove-dialog"))
			.not.toBeInTheDocument();
		expect(handlers["externalClients.revokeClient"]).not.toHaveBeenCalled();
		await expect
			.element(screen.getByTestId("external-ai-apps-clients"))
			.toMatchTextContent(/Cursor/);
	});

	it("saves a custom port and can return to the default", async () => {
		const { screen, handlers } = renderSettings();
		const port = screen.getByTestId("external-ai-apps-port");

		await port.fill("9400");
		await screen.getByTestId("external-ai-apps-port-save").click();

		await expect
			.poll(() => handlers["externalClients.setPort"].mock.calls[0]?.[0])
			.toEqual({
				port: 9400,
			});
		await screen.getByRole("button", { name: "Use default (9350)" }).click();
		await expect
			.poll(() => handlers["externalClients.setPort"].mock.calls[1]?.[0])
			.toEqual({
				port: null,
			});
		await expect.element(port).toHaveValue("9350");
	});

	it("does not save a port outside the allowed range", async () => {
		const { screen } = renderSettings();

		await screen.getByTestId("external-ai-apps-port").fill("80");

		await expect.element(screen.getByTestId("external-ai-apps-port-save")).toBeDisabled();
	});

	it("explains why the endpoint is not running", async () => {
		const { screen } = renderSettings(
			initialState({
				enabled: true,
				status: { status: "error", message: "Port 9350 is already in use. Choose another port." },
			}),
		);

		await expect
			.element(screen.getByTestId("external-ai-apps-error"))
			.toMatchTextContent(/Port 9350 is already in use\./);
	});

	it("follows state changes announced by the main process", async () => {
		const { screen, sdk } = renderSettings();
		await expect.element(screen.getByText("No apps paired yet.")).toBeVisible();

		// Main emits the unqualified name; the SDK namespaces it as kilo-server.*.
		sdk.events.emit(
			EXTERNAL_CLIENTS_CHANGED_EVENT,
			initialState({
				clients: [{ id: "a", name: "Claude Code", createdAt: "2026-10-07T12:00:00.000Z" }],
			}),
		);

		await expect
			.element(screen.getByTestId("external-ai-apps-clients"))
			.toMatchTextContent(/Claude Code/);
	});
});
