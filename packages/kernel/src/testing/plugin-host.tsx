/**
 * A fake plugin host for plugin authors: boots a real kernel pair with just
 * the plugins a test names, then renders one extension point's contributions
 * on their own, without the UI of the plugin that owns the point.
 *
 *   const host = await createPluginHost([
 *     { manifest: shellManifest, definitions: SHELL_DEFINITIONS }, // the point's owner: contracts only
 *     { manifest, definitions, web: myWebEntry, main: myMainEntry }, // the plugin under test
 *   ]);
 *   host.renderSlot(SidebarNotice);                  // every contribution, each in its plugin's sdk
 *   host.renderSlot(SettingsSection, {}, { select: (impl) => impl.component });
 *   await host.invoke(MyDomain, "refresh", {});      // a domain method, as the window's kernel calls it
 *   await host.invoke(MyDomain, "refresh", {}, { as: "acme.other" }); // as one plugin's window half
 *   await host.dispose();
 *
 * The point's owner only needs its manifest and contracts definitions, so the
 * point exists; give it entries too to test against its real behaviour. Host
 * primitives (`kernel/*` domain objects) are provided through `host.main.kernelSdk`.
 * Each main-process plugin gets in-memory storage. Rendering uses React DOM
 * directly (no testing library), so it works in any DOM test environment;
 * query the returned container or the page.
 */
import { useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { AnyDomainObject, DomainObjectMethods } from "../domain-object";
import { KernelError } from "../errors";
import type { AnyExtensionPoint, ImplementationOf } from "../extension-point";
import type { QualifiedId } from "../ids";
import type { MainKernelHost, MainKernelOptions } from "../main/main-kernel";
import type { PluginDefinitions, PluginEntry, PluginRegistration } from "../plugin";
import type { KernelLogger } from "../sdk";
import { KernelProvider, RenderContribution, useExtensions } from "../web/react";
import {
	createMemoryStorage,
	createTestHost,
	createTestKernelPair,
	type TestKernelPair,
} from "./index";

export interface HostedPlugin {
	readonly manifest: unknown;
	readonly definitions?: PluginDefinitions;
	readonly main?: PluginEntry;
	readonly web?: PluginEntry;
}

export interface PluginHostOptions {
	readonly host?: Partial<MainKernelHost>;
	/** Defaults to in-memory storage per plugin. */
	readonly mainHostServices?: MainKernelOptions["hostServices"];
	readonly logger?: KernelLogger;
}

export interface RenderSlotOptions<TImpl> {
	/** Picks the component out of an implementation object (`(impl) => impl.component`). */
	readonly select?: (implementation: TImpl) => unknown;
}

export interface RenderedSlot {
	readonly container: HTMLElement;
	/** Keys (`<plugin>/<id>`) of the contributions currently rendered, in point order. */
	keys(): string[];
	unmount(): void;
}

type MethodName<TDomain extends AnyDomainObject> = keyof DomainObjectMethods<TDomain> & string;
type MethodInput<TDomain extends AnyDomainObject, TMethod extends MethodName<TDomain>> = Parameters<
	DomainObjectMethods<TDomain>[TMethod]
>[0];
type MethodOutput<
	TDomain extends AnyDomainObject,
	TMethod extends MethodName<TDomain>,
> = ReturnType<DomainObjectMethods<TDomain>[TMethod]>;

export interface InvokeOptions {
	/**
	 * Call as this plugin's window half (it must be active in the window)
	 * instead of as the window's kernel, to exercise caller checks.
	 */
	readonly as?: string;
}

export interface PluginHost extends TestKernelPair {
	/** Renders every active contribution to `point`, each inside its own plugin's sdk. */
	renderSlot<TPoint extends AnyExtensionPoint>(
		point: TPoint | QualifiedId,
		props?: object,
		options?: RenderSlotOptions<ImplementationOf<TPoint>>,
	): RenderedSlot;
	/** Calls a domain method from the window: as the window's kernel, or `as` a plugin. */
	invoke<TDomain extends AnyDomainObject, TMethod extends MethodName<TDomain>>(
		domain: TDomain,
		method: TMethod,
		input: MethodInput<TDomain, TMethod>,
		options?: InvokeOptions,
	): MethodOutput<TDomain, TMethod>;
	invoke(
		domain: QualifiedId,
		method: string,
		input?: unknown,
		options?: InvokeOptions,
	): Promise<unknown>;
	/** Unmounts every rendered slot and stops both kernels. */
	dispose(): Promise<void>;
}

const CONTRIBUTION_ATTRIBUTE = "data-contribution-key";

function Slot({
	point,
	props,
	select,
}: {
	readonly point: AnyExtensionPoint | QualifiedId;
	readonly props: object | undefined;
	readonly select: ((implementation: never) => unknown) | undefined;
}) {
	const resolved = useMemo(
		() => (typeof point === "string" ? ({ id: point } as AnyExtensionPoint) : point),
		[point],
	);
	const contributions = useExtensions(resolved);
	return contributions.map((contribution) => (
		<div key={contribution.key} {...{ [CONTRIBUTION_ATTRIBUTE]: contribution.key }}>
			<RenderContribution
				contribution={contribution}
				{...(props ? { props } : {})}
				{...(select ? { select: select as never } : {})}
			/>
		</div>
	));
}

export async function createPluginHost(
	plugins: readonly HostedPlugin[],
	options: PluginHostOptions = {},
): Promise<PluginHost> {
	const registration = (plugin: HostedPlugin, entry: PluginEntry | undefined) => ({
		manifest: plugin.manifest,
		...(plugin.definitions ? { definitions: plugin.definitions } : {}),
		...(entry ? { entry } : {}),
	});
	const main: PluginRegistration[] = plugins.map((plugin) => registration(plugin, plugin.main));
	const renderer: PluginRegistration[] = plugins.map((plugin) => registration(plugin, plugin.web));
	const pair = await createTestKernelPair({
		main,
		renderer,
		host: createTestHost(options.host),
		mainHostServices:
			options.mainHostServices ??
			((pluginId) => ({ storage: createMemoryStorage(`/memory/${pluginId}`) })),
		...(options.logger ? { logger: options.logger } : {}),
	});

	const mounted = new Set<{ root: Root; container: HTMLElement }>();

	return {
		...pair,
		renderSlot(point, props, slotOptions) {
			const container = document.createElement("div");
			document.body.append(container);
			const root = createRoot(container);
			const handle = { root, container };
			mounted.add(handle);
			root.render(
				<KernelProvider kernel={pair.renderer}>
					<Slot
						point={point}
						props={props}
						select={slotOptions?.select as RenderSlotOptions<never>["select"]}
					/>
				</KernelProvider>,
			);
			return {
				container,
				keys: () =>
					[...container.querySelectorAll(`[${CONTRIBUTION_ATTRIBUTE}]`)].map(
						(element) => element.getAttribute(CONTRIBUTION_ATTRIBUTE) ?? "",
					),
				unmount() {
					if (!mounted.delete(handle)) return;
					root.unmount();
					container.remove();
				},
			};
		},
		invoke(
			domain: AnyDomainObject | QualifiedId,
			method: string,
			input?: unknown,
			invokeOptions: InvokeOptions = {},
		) {
			const definition = typeof domain === "string" ? ({ id: domain } as AnyDomainObject) : domain;
			let sdk;
			try {
				sdk = invokeOptions.as ? pair.renderer.sdkFor(invokeOptions.as) : pair.renderer.kernelSdk;
			} catch (error) {
				return Promise.reject(error);
			}
			const handle = sdk.domainObjects.get(definition);
			if (!handle) {
				return Promise.reject(
					new KernelError("UNAVAILABLE", `No plugin provides "${definition.id}".`),
				);
			}
			const methods = handle.methods as Record<string, (input: unknown) => Promise<unknown>>;
			return methods[method]!(input);
		},
		async dispose() {
			for (const { root, container } of mounted) {
				root.unmount();
				container.remove();
			}
			mounted.clear();
			await pair.renderer.deactivate();
			await pair.main.stop();
		},
	} as PluginHost;
}
