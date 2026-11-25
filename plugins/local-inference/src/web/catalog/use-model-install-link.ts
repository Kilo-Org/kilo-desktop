import { useEffect, useRef, useState } from "react";

import { KernelFlags } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState, useKernel, useSdk } from "@kilo-desktop/kernel/web";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { MODEL_CATALOG_FLAG, MODEL_INSTALL_DEEP_LINK } from "../../contracts/index";
import { useFlag, useTrack } from "../local-inference";
import {
	modelInstallLinkTelemetry,
	readModelInstallLink,
	type ModelInstallLink,
} from "./model-install-link";

export type ModelInstallRequest = Extract<ModelInstallLink, { kind: "install" }>;

/** An install request taken off the route; `id` tells two requests for one model apart. */
export type TakenModelInstallRequest = ModelInstallRequest & { readonly id: number };

/**
 * Takes a model install link off the window's route once: keeps it as local
 * state, clears it from the route (so back / forward and reloads don't
 * replay it), and tracks it. An invalid link or disabled catalog shows a
 * toast; an unsupported action is only logged.
 */
export function useModelInstallLink(): readonly [TakenModelInstallRequest | null, () => void] {
	const windowId = useKernel().window.id;
	const navigation = useDomainObject(Navigation);
	const search = useDomainObjectState(Navigation, (state) => state.windows[windowId]?.search);
	const catalogEnabled = useFlag(MODEL_CATALOG_FLAG);
	const flagsReady = useDomainObjectState(KernelFlags, (state) => state.ready) === true;
	const track = useTrack();
	const { logger } = useSdk();
	const [request, setRequest] = useState<TakenModelInstallRequest | null>(null);
	const taken = useRef<{ search: string | null; count: number }>({ search: null, count: 0 });

	useEffect(() => {
		const link = search ? readModelInstallLink(search) : null;
		if (!search || !link) {
			taken.current.search = null;
			return;
		}
		if (link.kind === "install" && !catalogEnabled && !flagsReady) {
			return;
		}
		// Another state change can re-deliver the link before the clear lands.
		const key = JSON.stringify(search);
		if (taken.current.search === key) return;
		taken.current.search = key;

		const location = navigation?.getState().windows[windowId];
		if (navigation && location) {
			void navigation.methods.navigate({ path: location.path, search: {} }).catch(() => undefined);
		}
		const { event, data } = modelInstallLinkTelemetry(link);
		track(event, data);

		if (link.kind === "install") {
			if (!catalogEnabled) {
				toast.error("The model catalog is not available.");
				return;
			}
			taken.current.count += 1;
			setRequest({ ...link, id: taken.current.count });
		} else if (link.reason === "unsupported-action") {
			const action = JSON.stringify((search[MODEL_INSTALL_DEEP_LINK.pathParam] ?? "").slice(0, 64));
			logger.warn(`Ignored a models link with the unsupported action ${action}.`);
		} else {
			toast.error("This model link is invalid.", {
				description: "Check the link and try again.",
			});
		}
	}, [search, navigation, windowId, catalogEnabled, flagsReady, track, logger]);

	// Bound to the request it was handed with so an older flow finishing
	// cannot clear a newer link that replaced it.
	const requestId = request?.id;
	const dismiss = () => setRequest((current) => (current?.id === requestId ? null : current));
	return [request, dismiss] as const;
}
