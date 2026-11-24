import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	KernelError,
	KernelOs,
	type ExternalPluginRecord,
	type ExternalPluginsState,
} from "@kilo-desktop/kernel";
import type { ExternalPluginsHost } from "@kilo-desktop/kernel/main";

import { renderShell, type GuestPlugin } from "../../testing";

const LOCAL_PLUGINS_FLAG = "local-plugins";

function plugin(overrides: Partial<ExternalPluginRecord> = {}): ExternalPluginRecord {
	return {
		folder: "hello",
		id: "acme.hello",
		displayName: "Hello",
		version: "0.1.0",
		hash: "abc123",
		status: "ready",
		approved: false,
		loaded: false,
		...overrides,
	};
}

/** A host whose approvals and toggles change its state the way the desktop host's do. */
function fakeExternalPlugins(initial: Partial<ExternalPluginsState> = {}) {
	let state: ExternalPluginsState = {
		enabled: true,
		directory: "/Users/me/Library/Application Support/Kilo/plugins",
		plugins: [],
		restartNeeded: false,
		...initial,
	};
	const listeners = new Set<() => void>();
	const update = (next: Partial<ExternalPluginsState>) => {
		state = { ...state, ...next };
		for (const listener of listeners) listener();
	};
	const host = {
		state: () => state,
		onChange: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setEnabled: vi.fn((enabled: boolean) => update({ enabled, restartNeeded: true })),
		approve: vi.fn(async (pluginId: string) => {
			update({
				restartNeeded: true,
				plugins: state.plugins.map((record) =>
					record.id === pluginId ? { ...record, approved: true } : record,
				),
			});
			return true;
		}),
		revoke: vi.fn(),
		refresh: vi.fn(async () => {}),
	} satisfies ExternalPluginsHost;
	return host;
}

async function openLocalPlugins(
	externalPlugins: ExternalPluginsHost,
	options: { relaunch?: () => void; guests?: readonly GuestPlugin[] } = {},
) {
	const showItemInFolder = vi.fn();
	await renderShell(options.guests ?? [], {
		desktop: true,
		flags: { [LOCAL_PLUGINS_FLAG]: true },
		externalPlugins,
		...(options.relaunch ? { relaunch: options.relaunch } : {}),
		beforeRender: (main) => {
			main.kernelSdk.domainObjects.provide(KernelOs, {
				initialState: {},
				methods: {
					openExternal: () => true,
					showItemInFolder: ({ path }) => showItemInFolder(path),
					showLogs: () => ({ revealed: true }),
					logFilePath: () => "/logs/main.log",
				},
			});
		},
	});
	window.location.hash = "#/settings/local-plugins";
	return { showItemInFolder };
}

describe("Local plugins settings", () => {
	it("warns that local plugins run with the app's access, and turns them on", async () => {
		const host = fakeExternalPlugins({ enabled: false });
		await openLocalPlugins(host);
		await expect
			.element(
				page.getByTestId("local-plugins-warning").getByText("Only use plugins you wrote or trust"),
			)
			.toBeInTheDocument();

		await page.getByTestId("local-plugins-enabled").click();

		expect(host.setEnabled).toHaveBeenCalledWith(true);
		await expect.element(page.getByTestId("local-plugins-restart")).toBeVisible();
		await expect.element(page.getByTestId("local-plugins-warning")).not.toBeVisible();
	});

	it("approves a plugin through the host and offers a restart", async () => {
		const host = fakeExternalPlugins({ plugins: [plugin()] });
		const relaunch = vi.fn();
		await openLocalPlugins(host, { relaunch });
		const row = page.getByTestId("local-plugin-hello");
		await expect.element(row.getByTestId("local-plugin-status")).toHaveTextContent("Disabled");

		await expect
			.element(row.getByTestId("local-plugin-allowed"))
			.toHaveAttribute("aria-checked", "false");
		await row.getByTestId("local-plugin-allowed").click();

		expect(host.approve).toHaveBeenCalledWith("acme.hello", "abc123");
		await expect
			.element(row.getByTestId("local-plugin-status"))
			.toHaveTextContent("Starts after restart");
		await page.getByTestId("local-plugins-restart-button").click();
		expect(relaunch).toHaveBeenCalledWith({ safeMode: false });
	});

	it("shows why a plugin can't load, and can't be allowed", async () => {
		await openLocalPlugins(
			fakeExternalPlugins({
				plugins: [
					plugin({
						status: "invalid",
						message: "Needs plugin API ^2.0; this app offers 1.0.0.",
					}),
				],
			}),
		);
		const row = page.getByTestId("local-plugin-hello");

		await expect
			.element(row.getByTestId("local-plugin-message"))
			.toHaveTextContent("Needs plugin API ^2.0; this app offers 1.0.0.");
		await expect.element(row.getByTestId("local-plugin-status")).toHaveTextContent("Can't load");
		await expect.element(row.getByTestId("local-plugin-allowed")).toBeDisabled();
	});

	it("withdraws a running plugin's permission", async () => {
		const host = fakeExternalPlugins({ plugins: [plugin({ approved: true, loaded: true })] });
		await openLocalPlugins(host);
		const row = page.getByTestId("local-plugin-hello");

		await expect
			.element(row.getByTestId("local-plugin-allowed"))
			.toHaveAttribute("aria-checked", "true");
		await row.getByTestId("local-plugin-allowed").click();

		expect(host.revoke).toHaveBeenCalledWith("acme.hello");
	});

	it("explains a failed approval", async () => {
		const host = fakeExternalPlugins({ plugins: [plugin()] });
		host.approve.mockRejectedValueOnce(
			new KernelError("CONFLICT", "The plugin's files changed. Refresh and review it again."),
		);
		await openLocalPlugins(host);

		await page.getByTestId("local-plugin-hello").getByTestId("local-plugin-allowed").click();

		await expect.element(page.getByText(/files changed/)).toBeVisible();
	});

	it("reveals the plugins folder and rescans it", async () => {
		const host = fakeExternalPlugins({ plugins: [plugin()] });
		const { showItemInFolder } = await openLocalPlugins(host);

		await page.getByTestId("local-plugins-reveal").click();
		await page.getByTestId("local-plugins-refresh").click();

		expect(showItemInFolder.mock.calls).toEqual([[host.state().directory]]);
		expect(host.refresh).toHaveBeenCalled();
	});

	it("offers to open the folder when there are no plugins yet", async () => {
		await openLocalPlugins(fakeExternalPlugins());

		await expect.element(page.getByTestId("local-plugins-empty")).toBeVisible();
	});
	it("says a loaded plugin failed to start, with the kernel's reason", async () => {
		const crashing: GuestPlugin = {
			manifest: {
				manifestVersion: 1,
				id: "acme.hello",
				displayName: "Hello",
				version: "0.1.0",
			},
			main: {
				activate() {
					throw new Error("Nope.");
				},
			},
		};
		await openLocalPlugins(
			fakeExternalPlugins({ plugins: [plugin({ approved: true, loaded: true })] }),
			{ guests: [crashing] },
		);
		const row = page.getByTestId("local-plugin-hello");

		await expect
			.element(row.getByTestId("local-plugin-status"))
			.toHaveTextContent("Failed to start");
		await expect.element(row.getByTestId("local-plugin-message")).toBeInTheDocument();
	});
});
