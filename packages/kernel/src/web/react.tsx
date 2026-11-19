import {
	Component,
	createContext,
	useContext,
	useRef,
	useSyncExternalStore,
	type ComponentType,
	type ErrorInfo,
	type ReactNode,
} from "react";

import type { AnyDomainObject, DomainObjectState } from "../domain-object";
import type { DomainObjectHandle } from "../domain-object-registry";
import type { AnyExtensionPoint } from "../extension-point";
import type { Contribution, ExclusiveResolution } from "../extension-registry";
import type { QualifiedId } from "../ids";
import type { PluginSdk } from "../sdk";
import type { RendererKernel } from "./renderer-kernel";

const KernelContext = createContext<RendererKernel | null>(null);
const SdkContext = createContext<PluginSdk | null>(null);

/**
 * Provides the window's kernel. Children use the kernel's own sdk unless `as`
 * names an active plugin, so a test can render one plugin's component outside
 * a contribution with that plugin's identity.
 */
export function KernelProvider({
	kernel,
	as,
	children,
}: {
	readonly kernel: RendererKernel;
	readonly as?: string;
	readonly children: ReactNode;
}) {
	const sdk = as === undefined ? kernel.kernelSdk : kernel.sdkFor(as);
	return (
		<KernelContext.Provider value={kernel}>
			<SdkContext.Provider value={sdk}>{children}</SdkContext.Provider>
		</KernelContext.Provider>
	);
}

export function useKernel(): RendererKernel {
	const kernel = useContext(KernelContext);
	if (!kernel) throw new Error("useKernel must be used inside <KernelProvider>.");
	return kernel;
}

/** The sdk of the plugin whose contribution is rendering this component. */
export function useSdk(): PluginSdk {
	const sdk = useContext(SdkContext);
	if (!sdk) throw new Error("useSdk must be used inside <KernelProvider>.");
	return sdk;
}

function useSubscription<T>(
	subscribe: (onChange: () => void) => () => void,
	read: () => T,
	isEqual: (a: T, b: T) => boolean,
): T {
	const cache = useRef<{ value: T } | null>(null);
	const getSnapshot = () => {
		const next = read();
		if (cache.current && isEqual(cache.current.value, next)) return cache.current.value;
		cache.current = { value: next };
		return next;
	};
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const sameContributions = (a: readonly Contribution[], b: readonly Contribution[]) =>
	a.length === b.length &&
	a.every(
		(contribution, index) =>
			contribution.key === b[index]!.key &&
			contribution.metadata === b[index]!.metadata &&
			contribution.implementation === b[index]!.implementation &&
			contribution.implementedRemotely === b[index]!.implementedRemotely,
	);

/** Active contributions to a point, re-rendering when they change. */
export function useExtensions<TPoint extends AnyExtensionPoint>(
	point: TPoint,
): readonly Contribution<TPoint>[] {
	const kernel = useKernel();
	const pointId = point.id;
	const subscribe = (onChange: () => void) =>
		kernel.extensions.subscribe((changedId) => {
			if (changedId === pointId) onChange();
		});
	const read = () => kernel.extensions.list(point);
	return useSubscription(subscribe, read, sameContributions);
}

/** The winner and fallback chain of an exclusive point. */
export function useExclusive<TPoint extends AnyExtensionPoint>(
	point: TPoint,
): ExclusiveResolution<TPoint> {
	const kernel = useKernel();
	const pointId = point.id;
	const subscribe = (onChange: () => void) =>
		kernel.extensions.subscribe((changedId) => {
			if (changedId === pointId) onChange();
		});
	const read = () => kernel.extensions.exclusive(point);
	return useSubscription(subscribe, read, (a, b) => sameContributions(a.chain, b.chain));
}

/** A domain handle for the current plugin, or null while no provider is available. */
export function useDomainObject<TDomain extends AnyDomainObject>(
	domain: TDomain,
): DomainObjectHandle<TDomain> | null {
	const kernel = useKernel();
	const sdk = useSdk();
	const subscribe = (onChange: () => void) =>
		kernel.domainObjects.onChange((id) => {
			if (id === domain.id) onChange();
		});
	const read = () => kernel.domainObjects.isProvided(domain.id);
	const provided = useSubscription(subscribe, read, Object.is);
	return provided ? sdk.domainObjects.get(domain) : null;
}

const sameSelection = Object.is;

/**
 * Selects from a domain's state; undefined while the domain is unavailable.
 * Re-renders when the selection changes by `isEqual` (default `Object.is`),
 * so a selector that builds a new object or array needs a structural check.
 */
export function useDomainObjectState<TDomain extends AnyDomainObject, TSelected>(
	domain: TDomain,
	selector: (state: DomainObjectState<TDomain>) => TSelected,
	isEqual: (a: TSelected, b: TSelected) => boolean = sameSelection,
): TSelected | undefined {
	const handle = useDomainObject(domain);
	const subscribe = (onChange: () => void) => handle?.subscribe(() => onChange()) ?? (() => {});
	const read = () => (handle ? selector(handle.getState()) : undefined);
	const isSameSelection = (a: TSelected | undefined, b: TSelected | undefined) =>
		a === undefined || b === undefined ? a === b : isEqual(a, b);
	return useSubscription(subscribe, read, isSameSelection);
}

export function useContextKey(key: string): boolean {
	const kernel = useKernel();
	const subscribe = (onChange: () => void) => kernel.contextKeys.subscribe(onChange);
	const read = () => kernel.contextKeys.get(key);
	return useSubscription(subscribe, read, Object.is);
}

function sdkOrNull(kernel: RendererKernel, pluginId: string): PluginSdk | null {
	try {
		return kernel.sdkFor(pluginId);
	} catch {
		return null;
	}
}

interface BoundaryProps {
	readonly onError: (error: unknown) => void;
	readonly children: ReactNode;
}

class ContributionBoundary extends Component<BoundaryProps, { readonly failed: boolean }> {
	override state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	override componentDidCatch(error: unknown, _info: ErrorInfo): void {
		this.props.onError(error);
	}

	override render(): ReactNode {
		return this.state.failed ? null : this.props.children;
	}
}

/**
 * Renders a contribution's component inside its plugin's sdk context and an
 * error boundary. A crash is reported to the registry, so an exclusive point
 * falls back to its next candidate.
 */
export function RenderContribution<TProps extends object>({
	contribution,
	props,
	select,
}: {
	readonly contribution: Contribution;
	readonly props?: TProps;
	/** Picks the component out of an implementation object (defaults to the implementation itself). */
	readonly select?: (implementation: never) => ComponentType<TProps> | undefined;
}) {
	const kernel = useKernel();
	const ContributedComponent = (
		select && contribution.implementation !== undefined
			? select(contribution.implementation as never)
			: contribution.implementation
	) as ComponentType<TProps> | undefined;
	const sdk = sdkOrNull(kernel, contribution.pluginId);
	if (!ContributedComponent || !sdk) return null;
	return (
		<ContributionBoundary
			key={contribution.key}
			onError={(error) => {
				kernel.kernelSdk.logger.error(`Contribution "${contribution.key}" crashed`, error);
				kernel.extensions.reportFailure(
					contribution.pointId,
					contribution.key as QualifiedId,
					error,
				);
			}}
		>
			<SdkContext.Provider value={sdk}>
				<ContributedComponent {...(props ?? ({} as TProps))} />
			</SdkContext.Provider>
		</ContributionBoundary>
	);
}
