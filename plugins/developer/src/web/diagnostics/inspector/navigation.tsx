import { createContext, useContext, useRef, useSyncExternalStore, type ReactNode } from "react";

import { KernelDomainObjects, type DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObjectState, useKernel } from "@kilo-desktop/kernel/web";

import { sameEntity, type EntityRef, type MainDomainObjects } from "../domain-model";

/**
 * Drill-down navigation inside Diagnostics. The inspector's breadcrumbs are
 * a trail of entities; a link opens its entity after the trail it sits in
 * (an expanded plugin row's links sit under that plugin), and opening one
 * already on the trail goes back to it rather than repeating it.
 */
interface Navigation {
	readonly trail: readonly EntityRef[];
	readonly go: (trail: readonly EntityRef[]) => void;
}

const NavigationContext = createContext<Navigation>({ trail: [], go: () => {} });

export function trailTo(trail: readonly EntityRef[], entity: EntityRef): EntityRef[] {
	const index = trail.findIndex((candidate) => sameEntity(candidate, entity));
	return index === -1 ? [...trail, entity] : trail.slice(0, index + 1);
}

/** Root of the navigation: `go` replaces the inspector's trail. */
export function NavigationProvider({
	go,
	children,
}: {
	readonly go: (trail: readonly EntityRef[]) => void;
	readonly children: ReactNode;
}) {
	const value = { trail: [], go };
	return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

/** Links inside open the entity after `trail`. */
export function TrailScope({
	trail,
	children,
}: {
	readonly trail: readonly EntityRef[];
	readonly children: ReactNode;
}) {
	const { go } = useContext(NavigationContext);
	const value = { trail, go };
	return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): Navigation {
	return useContext(NavigationContext);
}

/** An entity's id that opens it in the inspector. */
export function EntityLink({
	entity,
	children,
}: {
	readonly entity: EntityRef;
	readonly children?: ReactNode;
}) {
	const { trail, go } = useNavigation();
	return (
		<button
			type="button"
			className="text-primary-ink text-2xs w-fit text-left font-mono underline-offset-4 hover:underline"
			data-qa-id={`diagnostics-link-${entity.id}`}
			onClick={() => go(trailTo(trail, entity))}
		>
			{children ?? entity.id}
		</button>
	);
}

/**
 * A counter that moves whenever what the inspector reads may have changed:
 * contributions, implementations, plugin states, domain objects and context
 * keys. Views re-derive from the kernel when it moves.
 */
export function useKernelChanges(): number {
	const kernel = useKernel();
	const version = useRef(0);
	const subscribe = (onChange: () => void) => {
		const bump = () => {
			version.current++;
			onChange();
		};
		const unsubscribers = [
			kernel.extensions.subscribe(bump),
			kernel.onPluginStateChange(bump),
			kernel.domainObjects.onChange(bump),
			kernel.contextKeys.subscribe(bump),
		];
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	};
	const snapshot = () => version.current;
	return useSyncExternalStore(subscribe, snapshot, snapshot);
}

const selectMainDomainObjects = (state: DomainObjectState<typeof KernelDomainObjects>) =>
	state.domainObjects;

/** Main's view of which domain objects are provided (`kernel/domain-objects`), when this window sees it. */
export function useMainDomainObjects(): MainDomainObjects | undefined {
	return useDomainObjectState(KernelDomainObjects, selectMainDomainObjects) ?? undefined;
}
