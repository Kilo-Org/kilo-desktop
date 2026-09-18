import { createStaticNavigation } from "@kilo-desktop/feature-sdk";

import type { SdkNavigation, ShellLocation } from "@kilo-desktop/feature-sdk";

/**
 * The minimal structural surface of the shell's TanStack Router that the
 * navigation delegate needs (Decision #19). Typed structurally so the delegate
 * is testable with a fake and the router type never leaks past this module.
 */
export interface ShellRouterLike {
	state: {
		location: {
			pathname: string;
			search: Record<string, unknown>;
		};
	};
	navigate(options: {
		to: string;
		search?: Record<string, unknown>;
		replace?: boolean;
	}): Promise<void>;
	subscribe(event: "onResolved", handler: () => void): () => void;
}

/**
 * Adapt the shell router to the SDK navigation delegate. Features consume it
 * as `sdk.navigate(path)` + `sdk.location` — the router itself never crosses
 * the SDK boundary (it is deliberately NOT in the Shared Runtime Set).
 */
export function createRouterNavigation(router: ShellRouterLike): SdkNavigation {
	const currentLocation = (): ShellLocation => ({
		path: router.state.location.pathname,
		search: router.state.location.search,
	});

	return {
		navigate(path, options) {
			void router.navigate({
				to: path,
				...(options?.search !== undefined ? { search: options.search } : {}),
				...(options?.replace !== undefined ? { replace: options.replace } : {}),
			});
		},
		subscribe(fn) {
			// Observable contract: fire synchronously with the current value,
			// then push a snapshot after every resolved navigation.
			fn(currentLocation());
			return router.subscribe("onResolved", () => fn(currentLocation()));
		},
		peek: currentLocation,
	};
}

/**
 * Fallback delegate for hosts that boot a feature system without a router
 * (tests, tooling). Built on the SDK's shared static delegate (location
 * pinned to "/") with navigation upgraded to a warn-once no-op so the gap
 * stays visible during development.
 */
export function createInertNavigation(): SdkNavigation {
	let warned = false;
	return {
		...createStaticNavigation(),
		navigate(path) {
			if (!warned) {
				warned = true;
				console.warn(
					`[FeatureSystem] sdk.navigate("${path}"): no shell router is wired — navigation is a no-op.`,
				);
			}
		},
	};
}
