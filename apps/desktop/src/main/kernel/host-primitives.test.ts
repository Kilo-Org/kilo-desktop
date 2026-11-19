import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

import {
	KernelAppMenu,
	KernelClipboard,
	KernelDialogs,
	KernelDataCollection,
	KernelKeychain,
	KernelNativeTheme,
	KernelNotifications,
	KernelOs,
	KernelUpdater,
} from "@kilo-desktop/kernel";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createTestHost, createTestKernelPair, testPlugin } from "@kilo-desktop/kernel/testing";

import { provideHostPrimitives, type HostPrimitiveDeps } from "./host-primitives.js";

/** Consent saved like PreferencesStore: listeners hear effective consent; a build can force it off. */
function consentStore(options: { forcedOff?: boolean; failWith?: string } = {}) {
	let choice = true;
	const listeners = new Set<() => void>();
	return {
		choice: () => choice,
		allowed: () => !options.forcedOff && choice,
		installationId: () => "install-1",
		environment: "preview",
		setChoice: vi.fn(async (allow: boolean) => {
			choice = allow;
			for (const listener of listeners) listener();
			if (options.failWith) throw new Error(options.failWith);
		}),
		onChange: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

const UPDATER_STATE = {
	enabled: true,
	status: "idle",
	track: "stable",
	installedTrack: "stable",
	currentVersion: "1.0.0",
	availableVersion: null,
	downloadedVersion: null,
	downloadUrl: null,
	message: null,
	checkedAt: null,
	releaseNotes: [],
};

function deps(overrides: Partial<HostPrimitiveDeps> = {}): HostPrimitiveDeps {
	return {
		focusedWindow: () => undefined,
		dialog: {
			showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
			showSaveDialog: vi.fn(async () => ({ canceled: true })),
			showMessageBox: vi.fn(async () => ({ response: 0 })),
		},
		clipboard: { writeText: vi.fn() },
		os: {
			openExternal: vi.fn(async () => true),
			showItemInFolder: vi.fn(() => true),
			showLogs: vi.fn(() => true),
			logFilePath: () => "/logs/main.log",
		},
		notifications: {
			show: vi.fn(() => ({ delivered: true })),
			setBadge: vi.fn(() => ({ delivered: true })),
		},
		dataCollection: consentStore(),
		keychain: {
			get: vi.fn(async () => null),
			set: vi.fn(async () => {}),
			delete: vi.fn(async () => {}),
		},
		appMenu: vi.fn(),
		nativeTheme: {
			source: "dark",
			shouldUseDarkColors: () => true,
			onUpdated: () => () => {},
			setSource: vi.fn(),
			setChrome: vi.fn(),
		},
		...overrides,
	};
}

async function boot(hostDeps: HostPrimitiveDeps) {
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			testPlugin("acme.plain", { entry: { activate: () => {} } }),
			testPlugin("acme.trusted", {
				manifest: {
					permissions: {
						host: [
							"os",
							"clipboard",
							"keychain",
							"app-menu",
							"appearance",
							"updater",
							"data-collection",
							"dialogs",
							"notifications",
						],
					},
				},
				entry: { activate: () => {} },
			}),
		],
	});
	provideHostPrimitives(kernel.kernelSdk, hostDeps);
	await kernel.start();
	return kernel;
}

describe("host primitives", () => {
	it("refuses callers without the matching permission", async () => {
		const hostDeps = deps();
		const kernel = await boot(hostDeps);

		await expect(
			kernel
				.sdkFor("acme.plain")
				.domainObjects.get(KernelOs)!
				.methods.openExternal({ url: "https://x.test" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(
			kernel
				.sdkFor("acme.trusted")
				.domainObjects.get(KernelOs)!
				.methods.openExternal({ url: "https://x.test" }),
		).resolves.toBe(true);
		expect(hostDeps.os.openExternal).toHaveBeenCalledOnce();
	});

	it("saves through the native dialog with the caller's file filters", async () => {
		const hostDeps = deps();
		vi.mocked(hostDeps.dialog.showSaveDialog).mockResolvedValue({
			canceled: false,
			filePath: "/work/out.ipynb",
		});
		const kernel = await boot(hostDeps);
		const filters = [{ name: "Notebooks", extensions: ["ipynb"] }];

		await expect(
			kernel
				.sdkFor("acme.trusted")
				.domainObjects.get(KernelDialogs)!
				.methods.save({ defaultPath: "/work", filters }),
		).resolves.toEqual({ path: "/work/out.ipynb" });
		expect(hostDeps.dialog.showSaveDialog).toHaveBeenCalledWith(undefined, {
			defaultPath: "/work",
			filters,
		});
	});

	it("opens files or directories and returns nothing when canceled", async () => {
		const window = {} as Electron.BrowserWindow;
		const hostDeps = deps({ focusedWindow: () => window });
		vi.mocked(hostDeps.dialog.showOpenDialog)
			.mockResolvedValueOnce({ canceled: false, filePaths: ["/a", "/b"] })
			.mockResolvedValueOnce({ canceled: true, filePaths: ["/ignored"] });
		const kernel = await boot(hostDeps);
		const dialogs = kernel.sdkFor("acme.trusted").domainObjects.get(KernelDialogs)!;
		const filters = [{ name: "Data", extensions: ["csv"] }];

		await expect(
			dialogs.methods.open({
				title: "Pick",
				directory: true,
				multiple: true,
				defaultPath: "/work",
				filters,
			}),
		).resolves.toEqual({ paths: ["/a", "/b"] });
		expect(hostDeps.dialog.showOpenDialog).toHaveBeenLastCalledWith(window, {
			title: "Pick",
			defaultPath: "/work",
			filters,
			properties: ["openDirectory", "multiSelections"],
		});

		await expect(dialogs.methods.open({})).resolves.toEqual({ paths: [] });
		expect(hostDeps.dialog.showOpenDialog).toHaveBeenLastCalledWith(window, {
			properties: ["openFile"],
		});
	});

	it("returns a null save path when canceled or when no path is chosen", async () => {
		const hostDeps = deps();
		vi.mocked(hostDeps.dialog.showSaveDialog)
			.mockResolvedValueOnce({ canceled: true, filePath: "/ignored" })
			.mockResolvedValueOnce({ canceled: false });
		const kernel = await boot(hostDeps);
		const dialogs = kernel.sdkFor("acme.trusted").domainObjects.get(KernelDialogs)!;

		await expect(dialogs.methods.save({ title: "Export" })).resolves.toEqual({ path: null });
		expect(hostDeps.dialog.showSaveDialog).toHaveBeenLastCalledWith(undefined, {
			title: "Export",
		});
		await expect(dialogs.methods.save({})).resolves.toEqual({ path: null });
	});

	it("shows message boxes with only the options the caller set", async () => {
		const hostDeps = deps();
		vi.mocked(hostDeps.dialog.showMessageBox).mockResolvedValue({ response: 1 });
		const kernel = await boot(hostDeps);
		const dialogs = kernel.sdkFor("acme.trusted").domainObjects.get(KernelDialogs)!;

		await expect(
			dialogs.methods.message({
				type: "warning",
				message: "Discard?",
				detail: "Unsaved changes are lost.",
				buttons: ["Keep", "Discard"],
				defaultId: 0,
				cancelId: 0,
			}),
		).resolves.toEqual({ response: 1 });
		expect(hostDeps.dialog.showMessageBox).toHaveBeenLastCalledWith(undefined, {
			type: "warning",
			message: "Discard?",
			detail: "Unsaved changes are lost.",
			buttons: ["Keep", "Discard"],
			defaultId: 0,
			cancelId: 0,
		});

		await dialogs.methods.message({ message: "Done", buttons: ["OK"] });
		expect(hostDeps.dialog.showMessageBox).toHaveBeenLastCalledWith(undefined, {
			message: "Done",
			buttons: ["OK"],
		});
	});

	it("shows notifications and sets the badge count", async () => {
		const hostDeps = deps();
		const kernel = await boot(hostDeps);
		const notifications = kernel.sdkFor("acme.trusted").domainObjects.get(KernelNotifications)!;

		await expect(
			notifications.methods.show({ title: "Build done", body: "All green", silent: true }),
		).resolves.toEqual({ delivered: true });
		expect(hostDeps.notifications.show).toHaveBeenLastCalledWith({
			title: "Build done",
			message: "All green",
			silent: true,
		});
		await notifications.methods.show({ title: "Ping" });
		expect(hostDeps.notifications.show).toHaveBeenLastCalledWith({ title: "Ping", message: "" });
		await notifications.methods.setBadge({ count: 3 });
		expect(hostDeps.notifications.setBadge).toHaveBeenCalledWith(3);
	});

	it("namespaces keychain entries by the calling plugin", async () => {
		const hostDeps = deps();
		const kernel = await boot(hostDeps);

		await kernel
			.sdkFor("acme.trusted")
			.domainObjects.get(KernelKeychain)!
			.methods.set({ key: "token", value: "s3cret" });

		expect(hostDeps.keychain.set).toHaveBeenCalledWith("acme.trusted:token", "s3cret");
	});

	it("reads and deletes only the calling plugin's keychain entries", async () => {
		const hostDeps = deps();
		vi.mocked(hostDeps.keychain.get).mockResolvedValue("s3cret");
		const kernel = await boot(hostDeps);
		const keychain = kernel.sdkFor("acme.trusted").domainObjects.get(KernelKeychain)!;

		await expect(keychain.methods.get({ key: "token" })).resolves.toBe("s3cret");
		await keychain.methods.delete({ key: "token" });

		expect(hostDeps.keychain.get).toHaveBeenCalledWith("acme.trusted:token");
		expect(hostDeps.keychain.delete).toHaveBeenCalledWith("acme.trusted:token");
	});

	describe("app menu", () => {
		const MENUS = [
			{
				type: "submenu" as const,
				label: "File",
				items: [
					{ type: "command" as const, command: "acme.trusted/open" },
					{ type: "separator" as const },
					{ type: "role" as const, role: "close" as const, chord: "Shift+Meta+KeyW" },
				],
			},
		];

		async function bootWindow(hostDeps: HostPrimitiveDeps) {
			const trusted = testPlugin("acme.trusted", {
				manifest: { permissions: { host: ["app-menu"] } },
				entry: { activate: () => {} },
			});
			const pair = await createTestKernelPair({ main: [trusted], renderer: [trusted] });
			provideHostPrimitives(pair.main.kernelSdk, hostDeps);
			await pair.renderer.flush();
			return pair;
		}

		it("sets the menu of the window that calls", async () => {
			const hostDeps = deps();
			const { renderer } = await bootWindow(hostDeps);

			await renderer.sdkFor("acme.trusted").domainObjects.get(KernelAppMenu)!.methods.setMenu({
				menus: MENUS,
			});

			expect(hostDeps.appMenu).toHaveBeenCalledWith("main", MENUS);
		});

		it("refuses a menu set from main, which belongs to no window", async () => {
			const hostDeps = deps();
			const { main } = await bootWindow(hostDeps);

			await expect(
				main
					.sdkFor("acme.trusted")
					.domainObjects.get(KernelAppMenu)!
					.methods.setMenu({ menus: MENUS }),
			).rejects.toMatchObject({ code: "VALIDATION" });
			expect(hostDeps.appMenu).not.toHaveBeenCalled();
		});

		it("refuses OS actions outside the allowed set, such as developer tools", async () => {
			const hostDeps = deps();
			const { renderer } = await bootWindow(hostDeps);

			await expect(
				renderer
					.sdkFor("acme.trusted")
					.domainObjects.get(KernelAppMenu)!
					.methods.setMenu({
						menus: [
							{
								type: "submenu",
								label: "View",
								items: [{ type: "role", role: "toggleDevTools" as never }],
							},
						],
					}),
			).rejects.toMatchObject({ code: "VALIDATION" });
			expect(hostDeps.appMenu).not.toHaveBeenCalled();
		});
	});

	it("refuses to reveal a path the OS rejects", async () => {
		const hostDeps = deps({
			os: {
				openExternal: vi.fn(async () => true),
				showItemInFolder: vi.fn((path: string) => !/[\r\n]/.test(path)),
				showLogs: vi.fn(() => true),
				logFilePath: () => "/logs/main.log",
			},
		});
		const kernel = await boot(hostDeps);
		const os = kernel.sdkFor("acme.trusted").domainObjects.get(KernelOs)!;

		await expect(os.methods.showItemInFolder({ path: "/work/a.txt" })).resolves.toBeUndefined();
		await expect(
			os.methods.showItemInFolder({ path: "/work/a.txt\n--evil" }),
		).rejects.toMatchObject({ code: "BUSINESS" });
	});

	it("offers no clipboard reads and no opening of arbitrary paths", async () => {
		const hostDeps = deps();
		const kernel = await boot(hostDeps);
		const domains = kernel.sdkFor("acme.trusted").domainObjects;
		const clipboard = domains.get(KernelClipboard)!.methods as unknown as Record<
			string,
			(input: unknown) => Promise<unknown>
		>;
		const os = domains.get(KernelOs)!.methods as unknown as Record<
			string,
			(input: unknown) => Promise<unknown>
		>;

		await expect(clipboard.readText!(undefined)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(os.openPath!({ path: "/x.bin" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await domains.get(KernelClipboard)!.methods.writeText({ text: "λ" });
		expect(hostDeps.clipboard.writeText).toHaveBeenCalledWith("λ");
	});

	it("gives the log file's path and reports whether it was revealed", async () => {
		const kernel = await boot(deps());
		const os = kernel.sdkFor("acme.trusted").domainObjects.get(KernelOs)!;

		await expect(os.methods.logFilePath(undefined)).resolves.toBe("/logs/main.log");
		await expect(os.methods.showLogs(undefined)).resolves.toEqual({ revealed: true });
	});
});

describe("updater", () => {
	it("returns whether each request was accepted with the updater's state", async () => {
		const declined = { ...UPDATER_STATE, message: "Switching is not allowed." };
		const updater = {
			state: UPDATER_STATE,
			onChange: () => () => {},
			check: vi.fn(async () => ({
				accepted: true,
				state: { ...UPDATER_STATE, status: "checking" },
			})),
			install: vi.fn(() => ({ accepted: false, state: UPDATER_STATE })),
			setTrack: vi.fn(async () => ({ accepted: false, state: declined })),
		};
		const kernel = await boot(deps({ updater }));
		const methods = kernel.sdkFor("acme.trusted").domainObjects.get(KernelUpdater)!.methods;

		await expect(methods.check(undefined)).resolves.toMatchObject({
			accepted: true,
			state: { status: "checking" },
		});
		await expect(methods.install(undefined)).resolves.toMatchObject({ accepted: false });
		await expect(methods.setTrack({ track: "preview" })).resolves.toEqual({
			accepted: false,
			state: declined,
		});
		expect(updater.setTrack).toHaveBeenCalledWith("preview");
	});

	it("publishes state changes pushed by the updater", async () => {
		let push: (state: unknown) => void = () => {};
		const updater = {
			state: UPDATER_STATE,
			onChange: (listener: (state: unknown) => void) => {
				push = listener;
				return () => {};
			},
			check: vi.fn(),
			install: vi.fn(),
			setTrack: vi.fn(),
		};
		const kernel = await boot(deps({ updater }));
		const domain = kernel.sdkFor("acme.trusted").domainObjects.get(KernelUpdater)!;

		push({ ...UPDATER_STATE, status: "downloading", availableVersion: "1.1.0" });

		expect(domain.getState()).toMatchObject({ status: "downloading", availableVersion: "1.1.0" });
	});
});

describe("data collection", () => {
	it("publishes consent, the installation id and the environment", async () => {
		const kernel = await boot(deps({ dataCollection: consentStore({ forcedOff: true }) }));

		expect(kernel.sdkFor("acme.plain").domainObjects.get(KernelDataCollection)!.getState()).toEqual(
			{
				choice: true,
				allowed: false,
				installationId: "install-1",
				environment: "preview",
			},
		);
	});

	it("saves a permitted caller's choice and refuses other callers", async () => {
		const store = consentStore();
		const kernel = await boot(deps({ dataCollection: store }));
		const dataCollection = kernel.sdkFor("acme.trusted").domainObjects.get(KernelDataCollection)!;

		await dataCollection.methods.setChoice({ allowed: false });

		expect(dataCollection.getState()).toMatchObject({ choice: false, allowed: false });
		await expect(
			kernel
				.sdkFor("acme.plain")
				.domainObjects.get(KernelDataCollection)!
				.methods.setChoice({ allowed: true }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		expect(store.setChoice).toHaveBeenCalledOnce();
	});

	it("reports a failed change and still shows what was saved", async () => {
		const kernel = await boot(
			deps({ dataCollection: consentStore({ failWith: "Could not apply it everywhere." }) }),
		);
		const dataCollection = kernel.sdkFor("acme.trusted").domainObjects.get(KernelDataCollection)!;

		await expect(dataCollection.methods.setChoice({ allowed: false })).rejects.toMatchObject({
			message: "Could not apply it everywhere.",
		});
		expect(dataCollection.getState().choice).toBe(false);
	});

	it("reports a generic message when the failure carries none", async () => {
		const store = consentStore();
		store.setChoice.mockRejectedValueOnce("disk full");
		const kernel = await boot(deps({ dataCollection: store }));
		const dataCollection = kernel.sdkFor("acme.trusted").domainObjects.get(KernelDataCollection)!;

		await expect(dataCollection.methods.setChoice({ allowed: false })).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Could not update privacy settings.",
		});
	});
});

describe("native theme", () => {
	it("sets the OS colour scheme and window chrome for permitted callers", async () => {
		const hostDeps = deps();
		const kernel = await boot(hostDeps);
		const nativeTheme = kernel.sdkFor("acme.trusted").domainObjects.get(KernelNativeTheme)!;
		const chrome = {
			light: { background: "#ffffff", foreground: "#000000" },
			dark: { background: "#101010", foreground: "#f0f0f0" },
		};

		await nativeTheme.methods.setSource({ source: "light" });
		await nativeTheme.methods.setChrome(chrome);

		expect(hostDeps.nativeTheme.setSource).toHaveBeenCalledWith("light");
		expect(hostDeps.nativeTheme.setChrome).toHaveBeenCalledWith(chrome);
		expect(nativeTheme.getState()).toEqual({ source: "light", shouldUseDarkColors: true });
		await expect(
			kernel
				.sdkFor("acme.plain")
				.domainObjects.get(KernelNativeTheme)!
				.methods.setSource({ source: "dark" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
	});

	it("follows OS dark-mode changes", async () => {
		let dark = false;
		let notify: () => void = () => {};
		const hostDeps = deps();
		const kernel = await boot({
			...hostDeps,
			nativeTheme: {
				...hostDeps.nativeTheme,
				source: "system",
				shouldUseDarkColors: () => dark,
				onUpdated: (listener) => {
					notify = listener;
					return () => {};
				},
			},
		});
		const nativeTheme = kernel.sdkFor("acme.plain").domainObjects.get(KernelNativeTheme)!;
		expect(nativeTheme.getState()).toEqual({ source: "system", shouldUseDarkColors: false });

		dark = true;
		notify();

		expect(nativeTheme.getState()).toEqual({ source: "system", shouldUseDarkColors: true });
	});
});
