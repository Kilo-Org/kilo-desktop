import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	definePlugin,
	KernelError,
	KernelOs,
	type DomainObjectProvider,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	CORE_DEFINITIONS,
	KiloServer,
	type ServerStatus,
	type UserConfigFile,
} from "@kilo-desktop/plugin-core/contracts";

import shellManifest from "../../../plugin.json";
import {
	Notifications,
	SHELL_DEFINITIONS,
	SupportRow,
	type Notice,
	type NotificationContent,
} from "../../contracts";
import { activateSupport } from "./index";
import { RESTART_SERVER_COMMAND } from "./server-failure-notice";

const CONFIG_PATH = "/Users/me/.config/kilo/kilo.jsonc";

let host: PluginHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

interface BootOptions {
	readonly status?: ServerStatus;
	readonly userConfigFile?: () => UserConfigFile;
	readonly showItemInFolder?: () => void;
	/** Leaves kilo.shell's notifications unprovided (a browser build). */
	readonly withoutNotifications?: boolean;
}

/** The support area over a kilo.core server and kilo.shell notifications the test controls. */
async function bootSupport(options: BootOptions = {}) {
	const restart = vi.fn();
	const toasts: NotificationContent[] = [];
	let setStatus: (status: ServerStatus) => void = () => {};
	let notices: () => Record<string, Notice> = () => ({});

	const coreMain: PluginEntry = definePlugin({
		activate(sdk) {
			const server: DomainObjectProvider<typeof KiloServer> = sdk.domainObjects.provide(
				KiloServer,
				{
					initialState: options.status ?? { status: "ready", version: "7.8.17" },
					methods: {
						connect: () => {
							throw new KernelError("UNAVAILABLE", "Not in this test.");
						},
						restart,
						disposeInstance: () => {},
						userConfigFile: options.userConfigFile ?? (() => ({ path: CONFIG_PATH, exists: true })),
					},
				},
			);
			setStatus = (status) => server.setState(status);
		},
	});
	const shellMain: PluginEntry = definePlugin({
		activate(sdk) {
			if (options.withoutNotifications) return;
			const notifications: DomainObjectProvider<typeof Notifications> = sdk.domainObjects.provide(
				Notifications,
				{
					initialState: { notices: {} },
					methods: {
						toast: (content) => void toasts.push(content),
						post: ({ id, ...content }, caller) => {
							const key = `${caller.pluginId}/${id}`;
							notifications.setState({
								notices: {
									...notifications.state.notices,
									[key]: {
										...content,
										id: key,
										pluginId: caller.pluginId,
										createdAt: 0,
									},
								},
							});
							return key;
						},
						dismiss: ({ id }, caller) => {
							const { [`${caller.pluginId}/${id}`]: _dismissed, ...rest } =
								notifications.state.notices;
							notifications.setState({ notices: rest });
						},
					},
				},
			);
			notices = () => notifications.state.notices;
		},
	});

	host = await createPluginHost(
		[
			{ manifest: coreManifest, definitions: CORE_DEFINITIONS, main: coreMain },
			{
				manifest: shellManifest,
				definitions: SHELL_DEFINITIONS,
				main: shellMain,
				web: definePlugin({ activate: activateSupport }),
			},
		],
		{ host: { desktop: true } },
	);
	const showItemInFolder = vi.fn(options.showItemInFolder ?? (() => {}));
	host.main.kernelSdk.domainObjects.provide(KernelOs, {
		initialState: {},
		methods: {
			openExternal: () => true,
			showItemInFolder,
			showLogs: () => ({ revealed: true }),
			logFilePath: () => "/logs/main.log",
		},
	});
	return {
		host,
		restart,
		toasts,
		showItemInFolder,
		setStatus: (status: ServerStatus) => setStatus(status),
		notices: () => notices(),
	};
}

describe("Kilo server failures", () => {
	it("stays quiet while the server starts normally", async () => {
		const { setStatus, notices, host } = await bootSupport({ status: { status: "starting" } });

		setStatus({ status: "ready", version: "7.8.17" });

		// The renderer's mirror showing "ready" means its notice watcher saw it.
		await vi.waitFor(() =>
			expect(host.renderer.kernelSdk.domainObjects.get(KiloServer)?.getState()).toMatchObject({
				status: "ready",
			}),
		);
		expect(notices()).toEqual({});
	});

	it("posts one notice on failure, offers a restart and clears once running", async () => {
		const { setStatus, notices, restart, host } = await bootSupport({
			status: { status: "starting" },
		});

		setStatus({ status: "error", message: "Kilo server exited unexpectedly (exit code 1)." });
		await vi.waitFor(() =>
			expect(Object.values(notices())).toEqual([
				expect.objectContaining({
					level: "error",
					title: "Kilo isn't running",
					description: "Kilo server exited unexpectedly (exit code 1).",
					action: { label: "Restart", command: RESTART_SERVER_COMMAND },
				}),
			]),
		);

		await host.renderer.commands.execute(RESTART_SERVER_COMMAND);
		await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());

		setStatus({ status: "error", message: "Exited again." });
		await vi.waitFor(() =>
			expect(Object.values(notices())).toEqual([
				expect.objectContaining({ description: "Exited again." }),
			]),
		);
		setStatus({ status: "ready", version: "7.8.17" });
		await vi.waitFor(() => expect(notices()).toEqual({}));
	});

	it("reports a server that already failed when the window opens", async () => {
		const { notices } = await bootSupport({ status: { status: "error" } });
		await vi.waitFor(() =>
			expect(Object.values(notices())).toEqual([
				expect.not.objectContaining({ description: expect.anything() }),
			]),
		);
	});

	it("stays quiet without kilo.shell's notifications", async () => {
		const { setStatus, host } = await bootSupport({ withoutNotifications: true });
		setStatus({ status: "error", message: "down" });
		// The failure reached the renderer's watcher, which found no notifications.
		await vi.waitFor(() =>
			expect(host.renderer.kernelSdk.domainObjects.get(KiloServer)?.getState()).toMatchObject({
				status: "error",
			}),
		);
		expect(host.renderer.kernelSdk.domainObjects.get(Notifications)).toBeNull();
	});
});

describe("About → Support Kilo config", () => {
	it("shows where the user's Kilo config lives and reveals it", async () => {
		const { host, showItemInFolder } = await bootSupport();
		host.renderSlot(SupportRow);

		const row = page.getByTestId("about-global-kilo-config");
		await expect.element(row.getByText(CONFIG_PATH, { exact: true })).toBeVisible();
		await page.getByTestId("about-show-global-kilo-config").click();

		await vi.waitFor(() =>
			expect(showItemInFolder).toHaveBeenCalledWith({ path: CONFIG_PATH }, expect.anything()),
		);
	});

	it("says when there is no config file yet and offers nothing to reveal", async () => {
		const { host } = await bootSupport({
			userConfigFile: () => ({ path: CONFIG_PATH, exists: false }),
		});
		host.renderSlot(SupportRow);

		await expect
			.element(page.getByText("No global config file has been created yet."))
			.toBeInTheDocument();
		await expect.element(page.getByTestId("about-show-global-kilo-config")).toBeDisabled();
	});

	it("reports when the file manager cannot show the config", async () => {
		const { host, toasts } = await bootSupport({
			showItemInFolder: () => {
				throw new KernelError("BUSINESS", "Finder is unavailable.");
			},
		});
		host.renderSlot(SupportRow);

		await expect.element(page.getByTestId("about-show-global-kilo-config")).toBeEnabled();
		await page.getByTestId("about-show-global-kilo-config").click();

		await vi.waitFor(() =>
			expect(toasts).toEqual([
				expect.objectContaining({
					level: "error",
					title: "Could not show the Kilo config file",
					description: "Finder is unavailable.",
				}),
			]),
		);
	});

	it("explains when the config location cannot be found", async () => {
		const { host } = await bootSupport({
			userConfigFile: () => {
				throw new KernelError("BUSINESS", "Your home folder could not be found.");
			},
		});
		host.renderSlot(SupportRow);

		await expect
			.element(page.getByText("Your home folder could not be found."))
			.toBeInTheDocument();
		await expect.element(page.getByTestId("about-show-global-kilo-config")).toBeDisabled();
	});
});
