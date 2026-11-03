import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelRoot as RootPoint, KernelService, KernelWindowView } from "../builtins";
import { createMainKernel, type MainKernelHost } from "../main/main-kernel";
import type { PluginRegistration } from "../plugin";
import { testPlugin } from "../test-fixtures";
import { createLinkedTransports } from "../transport";
import { KernelRoot } from "./kernel-root";
import { KernelProvider, useSdk } from "./react";
import { createRendererKernel, type RendererWindow } from "./renderer-kernel";

function host(overrides: Partial<MainKernelHost> = {}): MainKernelHost {
	return {
		platform: "mac",
		version: "1.0.0",
		confirm: async () => true,
		quit: vi.fn(),
		relaunch: vi.fn(),
		...overrides,
	};
}

async function boot(
	web: PluginRegistration[],
	options: {
		main?: PluginRegistration[];
		host?: MainKernelHost;
		window?: Omit<RendererWindow, "id">;
	} = {},
) {
	const transports = createLinkedTransports();
	const mainHost = options.host ?? host();
	const main = createMainKernel({
		host: mainHost,
		transport: transports.main,
		registrations: options.main ?? web.map((registration) => ({ manifest: registration.manifest })),
	});
	await main.start();
	const renderer = createRendererKernel({
		windowId: "main",
		platform: "mac",
		transport: transports.connectRenderer("main"),
		registrations: web,
		...(options.window ? { window: options.window } : {}),
	});
	await renderer.activate();
	render(
		<KernelProvider kernel={renderer}>
			<KernelRoot />
		</KernelProvider>,
	);
	return { main, renderer, host: mainHost };
}

function rootPlugin(id: string, Component: () => React.ReactNode, priority = 0) {
	return testPlugin(id, {
		manifest: { contributes: { extensions: { "kernel/root": [{ id: "frame", priority }] } } },
		entry: {
			activate: (sdk) => {
				sdk.extensions.implement(RootPoint, "frame", Component);
			},
		},
	});
}

afterEach(() => {
	cleanup();
});

describe("KernelRoot", () => {
	it("renders the winning kernel/root contribution with its plugin's sdk", async () => {
		function Frame() {
			return <div data-qa-id="frame">Frame from {useSdk().pluginId}</div>;
		}

		await boot([rootPlugin("acme.shell", Frame)]);

		await expect.element(page.getByText("Frame from acme.shell")).toBeVisible();
	});

	it("falls back to the next root when the winner crashes while rendering", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		function Broken(): React.ReactNode {
			throw new Error("render failed");
		}
		function Spare() {
			return <div>Spare frame</div>;
		}

		await boot([rootPlugin("acme.broken", Broken, 10), rootPlugin("acme.spare", Spare)]);

		await expect.element(page.getByText("Spare frame")).toBeVisible();
		consoleError.mockRestore();
	});

	it("reports a healthy kernel with nothing installed yet", async () => {
		await boot([]);

		await expect.element(page.getByText("Kilo Desktop is running")).toBeVisible();
		await expect.element(page.getByText(/no plugins are installed yet/i)).toBeVisible();
		await expect.element(page.getByText("Kernel 1.0.0 on macOS")).toBeVisible();
		await expect.element(page.getByTestId("kernel-recovery-safe-mode")).not.toBeInTheDocument();
	});

	it("lists the plugins that started when none of them provides the interface", async () => {
		const quiet = testPlugin("acme.quiet", {
			manifest: { displayName: "Quiet Helper" },
			entry: { activate: () => {} },
		});

		await boot([quiet]);

		await expect.element(page.getByText("Kilo Desktop is running")).toBeVisible();
		await expect.element(page.getByText("1 plugin started: Quiet Helper")).toBeVisible();
		await expect
			.element(page.getByText(/none of them provides the app's interface/i))
			.toBeVisible();
	});

	it("counts the services that are running", async () => {
		const withService = testPlugin("acme.server", {
			manifest: {
				contributes: {
					extensions: {
						"kernel/service": [
							{ id: "daemon", title: "Daemon", kind: "daemon", startOn: "activation" },
						],
					},
				},
			},
			entry: {
				activate: (sdk) => {
					sdk.extensions.implement(KernelService, "daemon", { start: () => {} });
				},
			},
		});

		await boot([], { main: [withService] });

		await expect.element(page.getByText("1 service running")).toBeVisible();
	});

	it("explains a secondary window whose view is gone, and closes it on request", async () => {
		const close = vi.fn();
		const mainHost = host({
			windows: { open: vi.fn(), focus: vi.fn(), close, setHidden: vi.fn(), focusMain: vi.fn() },
		});

		await boot([], {
			host: mainHost,
			window: { role: "secondary", view: "acme.gone/view", params: {} },
		});

		await expect.element(page.getByText("This window's content isn't available")).toBeVisible();
		await page.getByTestId("kernel-recovery-close").click();
		await expect.poll(() => close).toHaveBeenCalledWith("main");
	});

	it("shows plugin problems and offers safe mode when something failed", async () => {
		const failing = testPlugin("acme.failing", {
			entry: {
				activate: () => {
					throw new Error("could not start");
				},
			},
		});

		const { host: mainHost } = await boot([], { main: [failing] });

		await expect.element(page.getByText("Kilo Desktop started with problems")).toBeVisible();
		await expect.element(page.getByText(/could not start/)).toBeVisible();
		await page.getByTestId("kernel-recovery-safe-mode").click();
		await expect.poll(() => mainHost.relaunch).toHaveBeenCalledWith({ safeMode: true });
		await page.getByTestId("kernel-recovery-quit").click();
		await expect.poll(() => mainHost.quit).toHaveBeenCalled();
	});

	it("offers a normal restart from safe mode", async () => {
		const mainHost = host({ safeMode: true });

		await boot([], { host: mainHost });

		await expect.element(page.getByText("Kilo Desktop is running in safe mode")).toBeVisible();
		await page.getByTestId("kernel-recovery-restart").click();
		await expect.poll(() => mainHost.relaunch).toHaveBeenCalledWith({ safeMode: false });
	});

	it("turns every plugin back on and restarts when plugins were turned off", async () => {
		const saveDisabled = vi.fn();
		const mainHost = host({
			plugins: { loadDisabled: () => ["acme.frame"], saveDisabled },
		});

		await boot([rootPlugin("acme.frame", () => <div>Frame</div>)], { host: mainHost });

		await expect.element(page.getByText("Frame")).not.toBeInTheDocument();
		await expect.element(page.getByText("1 plugin turned off: acme.frame")).toBeVisible();
		await page.getByTestId("kernel-recovery-enable-plugins").click();
		await expect.poll(() => mainHost.relaunch).toHaveBeenCalledWith({ safeMode: false });
		expect(saveDisabled).toHaveBeenLastCalledWith([]);
	});

	it("renders the requested view in a secondary window", async () => {
		const viewPlugin = testPlugin("acme.board", {
			manifest: {
				contributes: { extensions: { "kernel/window-view": [{ id: "board", title: "Board" }] } },
			},
			entry: {
				activate: (sdk) => {
					sdk.extensions.implement(KernelWindowView, "board", ({ params }) => (
						<div data-qa-id="board-view" style={{ height: "100%" }}>
							Board for {params.workspace}
						</div>
					));
				},
			},
		});

		await boot([viewPlugin], {
			window: { role: "secondary", view: "acme.board/board", params: { workspace: "w1" } },
		});

		await expect.element(page.getByText("Board for w1")).toBeVisible();
		// A view sized to its window (`h-full`) fills it rather than collapsing to its content.
		const view = page.getByTestId("board-view").element() as HTMLElement;
		expect(view.getBoundingClientRect().height).toBe(window.innerHeight);
	});
});
