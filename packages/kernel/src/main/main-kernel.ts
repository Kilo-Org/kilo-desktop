import {
	KERNEL_CONTEXT_KEYS,
	KERNEL_DEFINITIONS,
	KernelApp,
	KernelDomainObjects,
	KernelExtensions,
	KernelKeybindings,
	KernelPlugins,
	KernelQuit,
	KernelServices,
	KernelSystem,
	KernelWindowClose,
	KernelWindows,
	KernelWindowView,
	type AppPhase,
	type FlagValue,
} from "../builtins";
import { CommandService } from "../commands";
import { windowOrigin } from "../extension-registry";
import type { DomainObjectState } from "../domain-object";
import type { DomainObjectProvider } from "../domain-object-registry";
import { KernelError } from "../errors";
import { KERNEL_OWNER, ownerOf, type QualifiedId } from "../ids";
import { createKernel, type Kernel, type KernelOptions } from "../kernel";
import type { KeyboardPlatform } from "../keybindings";
import { provideFlags } from "./flags";
import { provideIdentity } from "./identity";
import { ServiceSupervisor } from "./service-supervisor";
import { provideTelemetry } from "./telemetry";

export interface WindowOpenRequest {
	readonly view: QualifiedId;
	readonly title: string;
	readonly params: Readonly<Record<string, string>>;
	readonly width?: number;
	readonly height?: number;
}

/** What the kernel needs from its host (Electron, or the browser shim). */
export interface MainKernelHost {
	readonly platform: KeyboardPlatform;
	readonly version: string;
	/** Origins the app's windows load from. */
	readonly rendererOrigins?: readonly string[];
	/** False in browser mode. Defaults to true. */
	readonly desktop?: boolean;
	/** Boot with no plugins so the user can recover from a broken one. */
	readonly safeMode?: boolean;
	/** Shows the merged reasons from an `ask` decision; resolves true to go ahead anyway. */
	confirm(kind: "quit" | "window-close", reasons: readonly string[]): Promise<boolean>;
	quit(): void;
	relaunch(options: { readonly safeMode: boolean }): void;
	readonly windows?: {
		open(request: WindowOpenRequest): Promise<string>;
		focus(windowId: string): void;
		close(windowId: string): void;
		setHidden(windowId: string, hidden: boolean): void;
		focusMain(): void;
	};
	readonly keybindings?: {
		load(): Readonly<Record<string, string | null>>;
		save(overrides: Readonly<Record<string, string | null>>): void;
	};
	/** Plugins the user turned off; read once at boot, so changes apply from the next launch. */
	readonly plugins?: {
		loadDisabled(): readonly string[];
		saveDisabled(disabled: readonly string[]): void;
	};
	readonly initialSystem?: Partial<SystemState>;
	/** Flag values forced by the build or the environment (development, e2e); they win over the flag source. */
	readonly flagOverrides?: Readonly<Record<string, FlagValue>>;
}

export interface MainKernelOptions extends Omit<
	KernelOptions,
	"process" | "windowId" | "kernelDefinitions" | "kernelContextKeys" | "beforeDeactivate"
> {
	readonly host: MainKernelHost;
}

interface SystemState {
	readonly online: boolean;
	readonly appearance: "light" | "dark";
	readonly appFocused: boolean;
	readonly suspended: boolean;
}

export interface MainKernel extends Kernel {
	readonly services: ServiceSupervisor;
	readonly commands: CommandService;
	/**
	 * Activates plugins (phase stays `starting` until the window shows) and
	 * resolves. Services wait for `environmentReady`: the host's process
	 * environment is final (the login shell's), as services spawn processes
	 * that inherit it. Activation services start as soon as it settles.
	 */
	start(options?: { readonly environmentReady?: Promise<unknown> }): Promise<void>;
	/**
	 * The main window is visible: `started`, then (once the environment is
	 * ready) window-shown services, then `ready`.
	 */
	windowShown(): Promise<void>;
	/** Runs `kernel/quit`; resolves true when the app should quit. */
	requestQuit(): Promise<boolean>;
	/** Runs `kernel/window-close`; resolves true when the window should close. */
	requestWindowClose(windowId: string): Promise<boolean>;
	/** `stopping`: services stop, plugins deactivate (reverse order), then `stopped`. */
	stop(): Promise<void>;
	/** An app URL was opened: kept as the launch URL before the window shows, announced after. */
	openUrl(url: string): void;
	readonly windowEvents: {
		opened(
			windowId: string,
			info: { readonly role: "main" | "secondary"; readonly view?: string },
		): void;
		focused(windowId: string): void;
		blurred(windowId: string): void;
		closed(windowId: string): void;
	};
	readonly systemEvents: {
		update(patch: Partial<SystemState>): void;
	};
}

export const DEFAULT_STOP_CAP_MS = 10_000;

/**
 * The main-process kernel. Owns the application lifecycle and the kernel's
 * hook domain objects (`kernel/app`, `plugins`, `services`, `domain-objects`,
 * `extensions`, `windows`, `system`, `keybindings`) and its product
 * vocabulary (`identity`, `flags`, `telemetry`, filled from above through
 * their extension points), runs the quit and
 * window-close decisions, and supervises services. Host primitives (dialogs,
 * clipboard…) are provided by the host through `kernelSdk`. The plugins the
 * user turned off are read from the host once, here, so turning one on or off
 * applies from the next launch; renderers follow main's `disabled` states.
 */
export function createMainKernel(options: MainKernelOptions): MainKernel {
	const { host } = options;
	const disabledAtLaunch = new Set(host.plugins?.loadDisabled() ?? []);
	const core = createKernel({
		...options,
		registrations: host.safeMode ? [] : options.registrations,
		isDisabled: (pluginId) => disabledAtLaunch.has(pluginId),
		// A plugin switched off by its `when` stops its services first, as at quit.
		beforeDeactivate: (pluginId) => services.stopPlugin(pluginId),
		process: "main",
		kernelDefinitions: KERNEL_DEFINITIONS,
		kernelContextKeys: KERNEL_CONTEXT_KEYS,
	});
	const { kernelSdk } = core;
	const logger = options.logger;

	kernelSdk.context.set("desktop", host.desktop ?? true);
	kernelSdk.context.set("mac", host.platform === "mac");
	kernelSdk.context.set("windows", host.platform === "windows");
	kernelSdk.context.set("linux", host.platform === "linux");
	kernelSdk.context.set("safeMode", host.safeMode ?? false);

	let launchUrl: string | null = null;
	const app = kernelSdk.domainObjects.provide(KernelApp, {
		initialState: {
			phase: "starting",
			safeMode: host.safeMode ?? false,
			version: host.version,
			platform: host.platform,
			rendererOrigins: [...(host.rendererOrigins ?? [])],
		},
		methods: {
			quit: () => host.quit(),
			relaunch: ({ safeMode }) => host.relaunch({ safeMode: safeMode ?? false }),
			takeLaunchUrl: () => {
				const url = launchUrl;
				launchUrl = null;
				return url;
			},
		},
	});
	const setPhase = (phase: AppPhase) => {
		if (app.state.phase === phase) return;
		app.update((state) => ({ ...state, phase }));
		app.emit("phase-changed", { phase });
	};

	providePlugins(core, host, [...disabledAtLaunch]);
	provideDomainObjectsAndExtensions(core);
	const windows = provideWindows(core, host);
	const system = provideSystem(core, host);
	provideKeybindings(core, host);
	provideIdentity(core);
	provideFlags(core, host.flagOverrides);
	provideTelemetry(core);

	const servicesProvider = kernelSdk.domainObjects.provide(KernelServices, {
		initialState: { services: {} },
		methods: {
			ensureStarted: ({ key }) => services.ensureStarted(key),
			restart: ({ key }) => services.restart(key),
		},
	});
	const services = new ServiceSupervisor({
		extensions: core.extensions,
		provider: servicesProvider,
		pluginOrder: (pluginId) =>
			core.discovery.plugins.findIndex((plugin) => plugin.manifest.id === pluginId),
		logger: kernelSdk.logger,
	});
	const commands = new CommandService({
		process: "main",
		extensions: core.extensions,
		...(options.transport ? { transport: options.transport } : {}),
		focusedWindow: () =>
			Object.entries(kernelSdk.domainObjects.get(KernelWindows)?.getState().windows ?? {}).find(
				([, window]) => window.focused,
			)?.[0],
	});

	let promptedToQuit = false;
	/** Settles once the host's process environment is final (see `start`). */
	let environmentReady: Promise<void> = Promise.resolve();
	const stopCapMs = DEFAULT_STOP_CAP_MS;

	return {
		...core,
		services,
		commands,
		async start(startOptions) {
			await core.activate();
			if (!startOptions?.environmentReady) {
				services.markActivated();
				return;
			}
			environmentReady = startOptions.environmentReady.then(
				() => undefined,
				() => undefined,
			);
			void environmentReady.then(() => services.markActivated());
		},
		async windowShown() {
			setPhase("started");
			await environmentReady;
			await services.markWindowShown();
			setPhase("ready");
		},
		async requestQuit() {
			if (promptedToQuit) return true;
			const decision = await kernelSdk.extensions.decide(KernelQuit, {});
			if (decision.outcome === "proceed") return true;
			promptedToQuit = true;
			const reasons = decision.outcome === "ask" ? decision.reasons : [decision.reason];
			return host.confirm("quit", reasons);
		},
		async requestWindowClose(windowId) {
			const decision = await kernelSdk.extensions.decide(KernelWindowClose, { windowId });
			if (decision.outcome === "proceed") return true;
			const reasons = decision.outcome === "ask" ? decision.reasons : [decision.reason];
			return host.confirm("window-close", reasons);
		},
		async stop() {
			setPhase("stopping");
			let timer: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([
				(async () => {
					await services.stopAll();
					await core.deactivate();
				})().catch((error: unknown) => logger?.error("Shutdown failed", error)),
				new Promise<void>((resolve) => {
					timer = setTimeout(() => {
						logger?.warn(`Shutdown exceeded ${stopCapMs} ms; quitting anyway.`);
						resolve();
					}, stopCapMs);
				}),
			]);
			if (timer !== undefined) clearTimeout(timer);
			setPhase("stopped");
		},
		openUrl(url) {
			if (app.state.phase === "starting") launchUrl = url;
			else app.emit("url-opened", { url });
		},
		windowEvents: windows,
		systemEvents: system,
	};
}

function providePlugins(core: Kernel, host: MainKernelHost, disabledAtLaunch: string[]): void {
	let disabled = disabledAtLaunch;
	const snapshot = () => ({
		plugins: Object.fromEntries(
			core.discovery.plugins.map((plugin) => [
				plugin.manifest.id,
				{
					displayName: plugin.manifest.displayName,
					version: plugin.manifest.version,
					state: core.pluginState(plugin.manifest.id) ?? plugin.status,
				},
			]),
		),
		issues: core.issues().map((issue) => ({ ...issue })),
		disabled,
	});
	const assertInstalled = (pluginIds: readonly string[]) => {
		const missing = pluginIds.find((id) => !core.manifest(id));
		if (missing !== undefined) throw new KernelError("NOT_FOUND", `No plugin "${missing}".`);
	};
	const saveDisabled = (next: string[]) => {
		disabled = next;
		host.plugins?.saveDisabled(next);
		provider.setState(snapshot());
	};
	const provider: DomainObjectProvider<typeof KernelPlugins> = core.kernelSdk.domainObjects.provide(
		KernelPlugins,
		{
			initialState: snapshot(),
			methods: {
				setEnabled: ({ pluginId, enabled }) => {
					if (!enabled) assertInstalled([pluginId]);
					const others = disabled.filter((id) => id !== pluginId);
					saveDisabled(enabled ? others : [...others, pluginId]);
				},
				setDisabled: ({ pluginIds }) => {
					assertInstalled(pluginIds);
					saveDisabled([...new Set(pluginIds)]);
				},
			},
		},
	);
	core.onPluginStateChange((pluginId, state) => {
		provider.setState(snapshot());
		provider.emit("state-changed", { pluginId, state });
	});
	core.onIssuesChange(() => provider.setState(snapshot()));
}

function provideDomainObjectsAndExtensions(core: Kernel): void {
	const snapshot = () => {
		const provided = new Set(core.domainObjects.providedIds());
		return {
			domainObjects: Object.fromEntries(
				[...core.discovery.domainObjects].map(([id, { owner, definition }]) => [
					id,
					{
						owner,
						home: definition.home,
						...(definition.description === undefined
							? {}
							: { description: definition.description }),
						...(definition.objectType ? { objectType: definition.objectType.id } : {}),
						provided: provided.has(id) || id === KernelDomainObjects.id,
					},
				]),
			),
		};
	};
	const domainObjects = core.kernelSdk.domainObjects.provide(KernelDomainObjects, {
		initialState: snapshot(),
		methods: {},
	});
	core.domainObjects.onChange((id, change) => {
		if (id === KernelDomainObjects.id) return;
		domainObjects.setState(snapshot());
		domainObjects.emit(change, { id });
	});

	const extensions = core.kernelSdk.domainObjects.provide(KernelExtensions, {
		initialState: {
			extensionPoints: Object.fromEntries(
				[...core.discovery.extensionPoints].map(([id, { owner, definition }]) => [
					id,
					{
						owner,
						kind: definition.kind,
						...(definition.description === undefined
							? {}
							: { description: definition.description }),
					},
				]),
			),
		},
		methods: {},
	});
	core.extensions.subscribe((extensionPointId) =>
		extensions.emit("contributions-changed", { extensionPointId }),
	);
}

function provideWindows(core: Kernel, host: MainKernelHost): MainKernel["windowEvents"] {
	const requireHost = () => {
		if (!host.windows) throw new KernelError("UNAVAILABLE", "Windows are not available here.");
		return host.windows;
	};
	/** What each opened window was opened with, until (and after) the host reports it. */
	const openedWith = new Map<string, { params: Record<string, string>; key?: string }>();
	/** Keyed opens in flight, so two quick opens of one key make one window. */
	const opening = new Map<string, Promise<{ windowId: string; opened: boolean }>>();
	const findKeyed = (view: string, key: string) =>
		Object.entries(provider.state.windows).find(
			([, window]) => window.view === view && window.key === key,
		)?.[0];
	const patch = (windowId: string, change: Partial<WindowRecord>) => {
		const current = provider.state.windows[windowId];
		if (!current) return;
		provider.setState({
			windows: { ...provider.state.windows, [windowId]: { ...current, ...change } },
		});
	};
	const setHidden = (windowId: string, hidden: boolean) => {
		requireHost().setHidden(windowId, hidden);
		patch(windowId, { hidden });
	};

	const provider: DomainObjectProvider<typeof KernelWindows> = core.kernelSdk.domainObjects.provide(
		KernelWindows,
		{
			initialState: { windows: {} },
			methods: {
				open: async ({ view, params, key, title, width, height }, caller) => {
					// Declared is enough: the new window's renderer implements the view.
					const contribution = core.extensions
						.all(KernelWindowView)
						.find((candidate) => candidate.key === view);
					if (!contribution) throw new KernelError("NOT_FOUND", `No window view "${view}".`);
					if (caller.pluginId !== KERNEL_OWNER && ownerOf(contribution.key) !== caller.pluginId) {
						throw new KernelError(
							"PERMISSION_DENIED",
							"Plugins can only open their own window views.",
						);
					}
					const windows = requireHost();
					if (key) {
						const existing = findKeyed(contribution.key, key);
						if (existing) {
							if (provider.state.windows[existing]?.hidden) setHidden(existing, false);
							windows.focus(existing);
							return { windowId: existing, opened: false };
						}
						const pending = opening.get(`${contribution.key}\n${key}`);
						if (pending) return { ...(await pending), opened: false };
					}
					const openWindow = async () => {
						const resolvedWidth = width ?? contribution.metadata.width;
						const resolvedHeight = height ?? contribution.metadata.height;
						const windowId = await windows.open({
							view: contribution.key,
							title: title ?? contribution.metadata.title,
							params: params ?? {},
							...(resolvedWidth ? { width: resolvedWidth } : {}),
							...(resolvedHeight ? { height: resolvedHeight } : {}),
						});
						const meta = { params: params ?? {}, ...(key ? { key } : {}) };
						openedWith.set(windowId, meta);
						patch(windowId, meta);
						return { windowId, opened: true };
					};
					if (!key) return openWindow();
					const pendingKey = `${contribution.key}\n${key}`;
					const pending = openWindow().finally(() => opening.delete(pendingKey));
					opening.set(pendingKey, pending);
					return pending;
				},
				focus: ({ windowId }) => requireHost().focus(windowId),
				close: ({ windowId }) => requireHost().close(windowId),
				setHidden: ({ windowId, hidden }) => {
					const window = provider.state.windows[windowId];
					if (!window) throw new KernelError("NOT_FOUND", "No such window.");
					if (window.role === "main") {
						throw new KernelError("VALIDATION", "The main window can't be hidden.");
					}
					setHidden(windowId, hidden);
				},
				focusMain: () => requireHost().focusMain(),
			},
		},
	);
	return {
		opened(windowId, info) {
			provider.setState({
				windows: {
					...provider.state.windows,
					[windowId]: {
						role: info.role,
						...(info.view ? { view: info.view } : {}),
						params: {},
						...openedWith.get(windowId),
						focused: false,
						hidden: false,
					},
				},
			});
			provider.emit("opened", { windowId });
		},
		focused(windowId) {
			patch(windowId, { focused: true });
			provider.emit("focused", { windowId });
		},
		blurred(windowId) {
			patch(windowId, { focused: false });
			provider.emit("blurred", { windowId });
		},
		closed(windowId) {
			openedWith.delete(windowId);
			core.extensions.clearRemoteImplementations(windowOrigin(windowId));
			const { [windowId]: _closed, ...rest } = provider.state.windows;
			provider.setState({ windows: rest });
			provider.emit("closed", { windowId });
		},
	};
}

type WindowRecord = DomainObjectState<typeof KernelWindows>["windows"][string];

function provideSystem(core: Kernel, host: MainKernelHost): MainKernel["systemEvents"] {
	const provider = core.kernelSdk.domainObjects.provide(KernelSystem, {
		initialState: {
			online: true,
			appearance: "light",
			appFocused: true,
			suspended: false,
			...host.initialSystem,
		},
		methods: {},
	});
	return {
		update(patch) {
			const previous = provider.state;
			const next = { ...previous, ...patch };
			provider.setState(next);
			if (next.online !== previous.online)
				provider.emit(next.online ? "online" : "offline", undefined);
			if (next.appearance !== previous.appearance) {
				provider.emit("appearance-changed", { appearance: next.appearance });
			}
			if (next.appFocused !== previous.appFocused) {
				provider.emit(next.appFocused ? "app-focused" : "app-blurred", undefined);
			}
			if (next.suspended !== previous.suspended) {
				provider.emit(next.suspended ? "suspend" : "resume", undefined);
			}
		},
	};
}

function provideKeybindings(core: Kernel, host: MainKernelHost): void {
	const save = (overrides: Record<string, string | null>): void => {
		provider.setState({ overrides });
		host.keybindings?.save(overrides);
	};
	const provider: DomainObjectProvider<typeof KernelKeybindings> =
		core.kernelSdk.domainObjects.provide(KernelKeybindings, {
			initialState: { overrides: { ...host.keybindings?.load() } },
			methods: {
				setOverride: ({ command, chord }) =>
					save({ ...provider.state.overrides, [command]: chord }),
				reset: ({ command }) => {
					const { [command]: _removed, ...rest } = provider.state.overrides;
					save(rest);
				},
				update: ({ set, reset }) => {
					const overrides = { ...provider.state.overrides, ...set };
					for (const command of reset) delete overrides[command];
					save(overrides);
				},
				resetAll: () => save({}),
			},
		});
}
