import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError, KernelOs, type PluginEntry } from "@kilo-desktop/kernel";
import { renderShell, type GuestPlugin } from "@kilo-desktop/plugin-shell/testing";
import { toast } from "@kilo-desktop/ui/components/sonner";

import manifest from "../../plugin.json";
import {
	AGENT_DEFINITIONS,
	AgentConfig,
	AgentServer,
	type ServerStatus,
	type UserConfigFile,
} from "../contracts";
import { agentWebEntry } from "./index";

const CONFIG_PATH = "/Users/me/.config/kilo/kilo.jsonc";

interface FakeAgent {
	setStatus(status: ServerStatus): void;
	readonly restart: ReturnType<typeof vi.fn>;
}

/** Stands in for kilo.agent's main entry with a server the test controls. */
function fakeAgentMain(
	initial: ServerStatus,
	userConfigFile: () => UserConfigFile | Promise<UserConfigFile>,
): { entry: PluginEntry; agent: FakeAgent } {
	const restart = vi.fn();
	let setStatus: (status: ServerStatus) => void = () => {};
	const entry: PluginEntry = {
		activate(sdk) {
			const server = sdk.domains.provide(AgentServer, {
				initialState: initial,
				methods: {
					connect: () => {
						throw new KernelError("UNAVAILABLE", "Not in this test.");
					},
					restart,
					disposeInstance: () => {},
				},
			});
			setStatus = (status) => server.setState(status);
			sdk.domains.provide(AgentConfig, {
				initialState: {},
				methods: {
					userConfigFile,
					storedApiKey: () => ({ key: null }),
					presentEnv: ({ names }) => ({ names }),
				},
			});
		},
	};
	return { entry, agent: { setStatus: (status) => setStatus(status), restart } };
}

async function renderApp(
	options: {
		status?: ServerStatus;
		userConfigFile?: () => UserConfigFile | Promise<UserConfigFile>;
		showItemInFolder?: (input: { path: string }) => void;
		path?: string;
	} = {},
) {
	const { entry, agent } = fakeAgentMain(
		options.status ?? { status: "ready", version: "7.8.17" },
		options.userConfigFile ?? (() => ({ path: CONFIG_PATH, exists: true })),
	);
	const showItemInFolder = vi.fn(options.showItemInFolder ?? (() => {}));
	const guests: GuestPlugin[] = [
		{ manifest, definitions: AGENT_DEFINITIONS, main: entry, web: agentWebEntry },
	];
	await renderShell(guests, {
		desktop: true,
		beforeRender: (main) => {
			main.kernelSdk.domains.provide(KernelOs, {
				initialState: {},
				methods: {
					openExternal: () => true,
					showItemInFolder,
					showLogs: () => ({ revealed: true }),
					logFilePath: () => "/logs/main.log",
				},
			});
		},
	});
	if (options.path) window.location.hash = `#${options.path}`;
	return { agent, showItemInFolder };
}

afterEach(() => {
	toast.dismiss();
});

describe("Kilo server failures", () => {
	it("stays quiet while the server starts normally", async () => {
		const { agent } = await renderApp({ status: { status: "starting" } });

		agent.setStatus({ status: "ready", version: "7.8.17" });

		await expect.element(page.getByTestId("app-sidebar")).toBeVisible();
		await expect.element(page.getByText("Kilo isn't running")).not.toBeInTheDocument();
	});

	it("explains a failure in a toast, restarts on request and clears once running", async () => {
		const { agent } = await renderApp({ status: { status: "starting" } });

		agent.setStatus({ status: "error", message: "Kilo server exited unexpectedly (exit code 1)." });

		await expect.element(page.getByText("Kilo isn't running")).toBeVisible();
		await expect
			.element(page.getByText("Kilo server exited unexpectedly (exit code 1)."))
			.toBeVisible();
		await page.getByRole("button", { name: "Restart" }).click();
		await vi.waitFor(() => expect(agent.restart).toHaveBeenCalledOnce());

		agent.setStatus({ status: "error", message: "Kilo server exited unexpectedly (exit code 1)." });
		agent.setStatus({ status: "ready", version: "7.8.17" });
		await expect.element(page.getByText("Kilo isn't running")).not.toBeInTheDocument();
	});
});

describe("About → Support Kilo config", () => {
	it("shows where the user's Kilo config lives and reveals it", async () => {
		const { showItemInFolder } = await renderApp({ path: "/settings/about" });

		const row = page.getByTestId("about-global-kilo-config");
		await expect.element(row.getByText(CONFIG_PATH, { exact: true })).toBeVisible();
		await page.getByTestId("about-show-global-kilo-config").click();

		await vi.waitFor(() =>
			expect(showItemInFolder).toHaveBeenCalledWith({ path: CONFIG_PATH }, expect.anything()),
		);
	});

	it("says when there is no config file yet and offers nothing to reveal", async () => {
		await renderApp({
			path: "/settings/about",
			userConfigFile: () => ({ path: CONFIG_PATH, exists: false }),
		});

		await expect
			.element(page.getByText("No global config file has been created yet."))
			.toBeInTheDocument();
		await expect.element(page.getByTestId("about-show-global-kilo-config")).toBeDisabled();
	});

	it("reports when the file manager cannot show the config", async () => {
		await renderApp({
			path: "/settings/about",
			showItemInFolder: () => {
				throw new KernelError("BUSINESS", "Finder is unavailable.");
			},
		});

		await page.getByTestId("about-show-global-kilo-config").click();

		await expect.element(page.getByText("Could not show the Kilo config file")).toBeVisible();
	});

	it("explains when the config location cannot be found", async () => {
		await renderApp({
			path: "/settings/about",
			userConfigFile: () => {
				throw new KernelError("BUSINESS", "Your home folder could not be found.");
			},
		});

		await expect
			.element(page.getByText("Your home folder could not be found."))
			.toBeInTheDocument();
		await expect.element(page.getByTestId("about-show-global-kilo-config")).toBeDisabled();
	});
});
