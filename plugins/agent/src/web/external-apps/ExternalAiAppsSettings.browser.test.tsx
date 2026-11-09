import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError, type DomainProvider, type PluginEntry } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { renderShell, type GuestPlugin } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../../plugin.json";
import {
	AGENT_DEFINITIONS,
	AgentConfig,
	AgentServer,
	ExternalClients,
	type ExternalClientsState,
} from "../../contracts";
import { agentWebEntry } from "../index";

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

const running = (port: number) => ({
	status: "running" as const,
	url: `http://127.0.0.1:${port}/mcp`,
});

/** Stands in for kilo.agent's main entry, with external AI apps the test controls. */
function fakeAgentMain(initial: ExternalClientsState) {
	let provider: DomainProvider<typeof ExternalClients> | undefined;
	const write = (next: ExternalClientsState) => provider?.setState(next);
	const state = () => provider!.state;
	const handlers = {
		setEnabled: vi.fn(({ enabled }: { enabled: boolean }) => {
			write({
				...state(),
				enabled,
				status: enabled ? running(state().port) : { status: "stopped" },
			});
		}),
		setPort: vi.fn(({ port }: { port: number | null }) => {
			const next = port ?? state().defaultPort;
			write({ ...state(), port: next, ...(state().enabled ? { status: running(next) } : {}) });
		}),
		pair: vi.fn(({ name }: { name: string }) => {
			const client = { id: `id-${name}`, name, createdAt: "2026-10-07T12:00:00.000Z" };
			write({ ...state(), clients: [...state().clients, client] });
			return { client, token: "secret-token-123" };
		}),
		revoke: vi.fn(({ id }: { id: string }) => {
			write({ ...state(), clients: state().clients.filter((client) => client.id !== id) });
		}),
	};
	const entry: PluginEntry = {
		activate(sdk) {
			sdk.domains.provide(AgentServer, {
				initialState: { status: "ready", version: "7.8.17" },
				methods: {
					connect: () => {
						throw new KernelError("UNAVAILABLE", "Not in this test.");
					},
					restart: () => {},
					disposeInstance: () => {},
				},
			});
			sdk.domains.provide(AgentConfig, {
				initialState: {},
				methods: {
					userConfigFile: () => ({ path: "/home/.config/kilo/kilo.jsonc", exists: false }),
					storedApiKey: () => ({ key: null }),
					presentEnv: ({ names }) => ({ names }),
				},
			});
			provider = sdk.domains.provide(ExternalClients, {
				initialState: initial,
				methods: handlers,
			});
		},
	};
	return { entry, handlers, write };
}

/** kilo.flags with External AI apps' flag on or off. */
function flags(on: boolean): GuestPlugin {
	return {
		manifest: testManifest("kilo.flags", {
			contextKeys: [{ id: "flag:*", scope: "global" }],
		}),
		main: {
			activate: (sdk) => sdk.context.set("flag:external-api-apps-settings", on),
		},
	};
}

async function renderSettings(
	initial: ExternalClientsState = initialState(),
	options: { flag?: boolean } = {},
) {
	const agent = fakeAgentMain(initial);
	await renderShell(
		[
			{ manifest, definitions: AGENT_DEFINITIONS, main: agent.entry, web: agentWebEntry },
			flags(options.flag ?? true),
		],
		{ desktop: true },
	);
	window.location.hash = "#/settings/external-ai-apps";
	return { screen: page, ...agent };
}

afterEach(() => {
	window.location.hash = "";
});

describe("ExternalAiAppsSettings", () => {
	it("is listed in the AI group only while its flag is on", async () => {
		const { screen } = await renderSettings(initialState(), { flag: false });
		window.location.hash = "#/settings/kilo-providers";

		await expect.element(screen.getByTestId("settings-section-kilo-providers")).toBeVisible();
		await expect
			.element(screen.getByTestId("settings-section-external-ai-apps"))
			.not.toBeInTheDocument();
	});

	it("starts switched off with no paired apps", async () => {
		const { screen } = await renderSettings();

		await expect.element(screen.getByRole("heading", { name: "External AI apps" })).toBeVisible();
		await expect
			.element(screen.getByRole("switch", { name: "Allow external AI apps" }))
			.not.toBeChecked();
		await expect.element(screen.getByTestId("external-ai-apps-status")).toHaveTextContent("Off");
		await expect.element(screen.getByText("No apps paired yet.")).toBeVisible();
	});

	it("turns the endpoint on and shows where it listens", async () => {
		const { screen, handlers } = await renderSettings();

		await screen.getByRole("switch", { name: "Allow external AI apps" }).click();

		await vi.waitFor(() =>
			expect(handlers.setEnabled.mock.calls[0]?.[0]).toEqual({ enabled: true }),
		);
		await expect
			.element(screen.getByTestId("external-ai-apps-status"))
			.toMatchTextContent(/http:\/\/127\.0\.0\.1:9350\/mcp/);
	});

	it("pairs an app and shows its token once with generic setup instructions", async () => {
		const { screen, handlers } = await renderSettings(
			initialState({ enabled: true, status: running(DEFAULT_PORT) }),
		);

		await screen.getByTestId("external-ai-apps-client-name").fill("Cursor on this Mac");
		await screen.getByTestId("external-ai-apps-pair").click();

		await vi.waitFor(() =>
			expect(handlers.pair.mock.calls[0]?.[0]).toEqual({ name: "Cursor on this Mac" }),
		);
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
			.toMatchTextContent(/URL: http:\/\/127\.0\.0\.1:9350\/mcp/);
		await expect
			.element(dialog.getByTestId("external-client-setup"))
			.toMatchTextContent(/Authorization: Bearer secret-token-123/);

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
		const { screen } = await renderSettings(initialState({ enabled: true }));
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
	});

	it("lets users pair apps only while external AI apps are allowed", async () => {
		const { screen } = await renderSettings();

		await expect.element(screen.getByTestId("external-ai-apps-client-name")).toBeDisabled();
		await expect.element(screen.getByTestId("external-ai-apps-pair")).toBeDisabled();
		await expect
			.element(screen.getByTestId("external-ai-apps-pair-hint"))
			.toHaveTextContent("Turn on Allow external AI apps to pair an app.");

		await screen.getByRole("switch", { name: "Allow external AI apps" }).click();

		await expect.element(screen.getByTestId("external-ai-apps-client-name")).toBeEnabled();
		await expect.element(screen.getByTestId("external-ai-apps-pair-hint")).not.toBeInTheDocument();
	});

	it("removes a paired app after the user confirms, and keeps it on cancel", async () => {
		const { screen, handlers } = await renderSettings(
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
		expect(handlers.revoke).not.toHaveBeenCalled();

		await screen.getByRole("button", { name: "Remove Cursor" }).click();
		const dialog = screen.getByTestId("external-client-remove-dialog");
		await expect.element(dialog).toMatchTextContent(/Remove Cursor\?/);
		await dialog.getByTestId("external-client-remove-confirm").click();

		await vi.waitFor(() => expect(handlers.revoke.mock.calls[0]?.[0]).toEqual({ id: "cursor" }));
		await expect.element(screen.getByText("No apps paired yet.")).toBeVisible();
	});

	it("saves a custom port and can return to the default", async () => {
		const { screen, handlers } = await renderSettings();
		const port = screen.getByTestId("external-ai-apps-port");

		await port.fill("9400");
		await screen.getByTestId("external-ai-apps-port-save").click();

		await vi.waitFor(() => expect(handlers.setPort.mock.calls[0]?.[0]).toEqual({ port: 9400 }));
		await screen.getByRole("button", { name: "Use default (9350)" }).click();
		await vi.waitFor(() => expect(handlers.setPort.mock.calls[1]?.[0]).toEqual({ port: null }));
		await expect.element(port).toHaveValue("9350");
	});

	it("does not save a port outside the allowed range", async () => {
		const { screen } = await renderSettings();

		await screen.getByTestId("external-ai-apps-port").fill("80");

		await expect.element(screen.getByTestId("external-ai-apps-port-save")).toBeDisabled();
	});

	it("explains why the endpoint is not running", async () => {
		const { screen } = await renderSettings(
			initialState({
				enabled: true,
				status: { status: "error", message: "Port 9350 is already in use. Choose another port." },
			}),
		);

		await expect
			.element(screen.getByTestId("external-ai-apps-error"))
			.toMatchTextContent(/Port 9350 is already in use\./);
		await expect
			.element(screen.getByTestId("external-ai-apps-status"))
			.toHaveTextContent("Not running");
	});

	it("shows why an action failed", async () => {
		const { screen, handlers } = await renderSettings();
		handlers.setEnabled.mockImplementationOnce(() => {
			throw new KernelError("BUSINESS", "External AI apps are not available.");
		});

		await screen.getByRole("switch", { name: "Allow external AI apps" }).click();

		await expect.element(screen.getByText("External AI apps are not available.")).toBeVisible();
	});

	it("follows state changes made elsewhere", async () => {
		const { screen, write } = await renderSettings();
		await expect.element(screen.getByText("No apps paired yet.")).toBeVisible();

		write(
			initialState({
				clients: [
					{
						id: "a",
						name: "Claude Code",
						createdAt: "2026-10-07T12:00:00.000Z",
						lastUsedAt: "2026-10-08T12:00:00.000Z",
					},
				],
			}),
		);

		await expect
			.element(screen.getByTestId("external-ai-apps-clients"))
			.toMatchTextContent(/Claude Code.*Last used/);
	});
});
