import {
	KernelClipboard,
	KernelDataCollection,
	KernelError,
	KernelNativeTheme,
	KernelNotifications,
	KernelOs,
	detectKeyboardPlatform,
	type DomainProvider,
	type KernelLogger,
	type KernelTransport,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";

const DISABLED_PLUGINS_KEY = "kernel:disabled-plugins";

function loadDisabledPlugins(): string[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(DISABLED_PLUGINS_KEY) ?? "[]");
		return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
	} catch {
		return [];
	}
}

const unavailable = (what: string) => () => {
	throw new KernelError("UNAVAILABLE", `${what} isn't available in the browser.`);
};

/**
 * Browser mode (no Electron): runs the main kernel in the page, linked to the
 * renderer kernel in memory. Host primitives map to web APIs where they exist;
 * windows, dialogs and the keychain are unavailable.
 */
export async function startBrowserMainKernel(options: {
	readonly transport: KernelTransport;
	readonly registrations: readonly PluginRegistration[];
	/** Plugins with a window entry; the window may only call main as these. */
	readonly webPlugins: Iterable<string>;
	readonly logger: KernelLogger;
	/** Reloads the page to "relaunch"; injectable because tests cannot reload their own page. */
	readonly reload?: () => void;
}): Promise<MainKernel> {
	const kernel = createMainKernel({
		registrations: options.registrations,
		webPlugins: options.webPlugins,
		transport: options.transport,
		logger: options.logger,
		host: {
			platform: detectKeyboardPlatform(),
			version: "browser",
			desktop: false,
			initialSystem: {
				online: navigator.onLine,
				appearance: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
			},
			confirm: async (_kind, reasons) => window.confirm(reasons.join("\n")),
			quit: () => window.close(),
			relaunch: () => (options.reload ?? (() => window.location.reload()))(),
			plugins: {
				loadDisabled: loadDisabledPlugins,
				saveDisabled: (disabled) =>
					localStorage.setItem(DISABLED_PLUGINS_KEY, JSON.stringify(disabled)),
			},
		},
	});
	kernel.kernelSdk.domains.provide(KernelOs, {
		initialState: {},
		methods: {
			openExternal: ({ url }) => window.open(url, "_blank", "noopener,noreferrer") !== null,
			showItemInFolder: unavailable("Showing files"),
			showLogs: unavailable("Application logs"),
			logFilePath: unavailable("Application logs"),
		},
	});
	// Browser mode cannot grant consent to desktop reporting.
	kernel.kernelSdk.domains.provide(KernelDataCollection, {
		initialState: {
			choice: false,
			allowed: false,
			installationId: "browser",
			environment: "development",
		},
		methods: {
			setChoice: () => {
				throw new KernelError("UNAVAILABLE", "Privacy settings are available in the desktop app.");
			},
		},
	});
	kernel.kernelSdk.domains.provide(KernelClipboard, {
		initialState: {},
		methods: {
			writeText: ({ text }) => navigator.clipboard.writeText(text),
		},
	});
	kernel.kernelSdk.domains.provide(KernelNotifications, {
		initialState: {},
		methods: {
			show: ({ title, body }) => {
				if (typeof Notification === "undefined" || Notification.permission !== "granted") {
					return { delivered: false };
				}
				new Notification(title, body ? { body } : {});
				return { delivered: true };
			},
			setBadge: () => {},
		},
	});
	const darkQuery = matchMedia("(prefers-color-scheme: dark)");
	const nativeTheme: DomainProvider<typeof KernelNativeTheme> = kernel.kernelSdk.domains.provide(
		KernelNativeTheme,
		{
			initialState: { source: "system", shouldUseDarkColors: darkQuery.matches },
			methods: {
				setSource: ({ source }): void =>
					nativeTheme.setState({
						source,
						shouldUseDarkColors: source === "system" ? darkQuery.matches : source === "dark",
					}),
				setChrome: () => {},
			},
		},
	);
	darkQuery.addEventListener("change", () => {
		kernel.systemEvents.update({ appearance: darkQuery.matches ? "dark" : "light" });
		if (nativeTheme.state.source === "system") {
			nativeTheme.setState({ source: "system", shouldUseDarkColors: darkQuery.matches });
		}
	});
	window.addEventListener("online", () => kernel.systemEvents.update({ online: true }));
	window.addEventListener("offline", () => kernel.systemEvents.update({ online: false }));
	await kernel.start();
	kernel.windowEvents.opened("main", { role: "main" });
	const followFocus = () => {
		const focused = document.hasFocus();
		if (focused) kernel.windowEvents.focused("main");
		else kernel.windowEvents.blurred("main");
		kernel.systemEvents.update({ appFocused: focused });
	};
	followFocus();
	window.addEventListener("focus", followFocus);
	window.addEventListener("blur", followFocus);
	return kernel;
}
