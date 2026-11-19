import { useEffect, useRef, useState } from "react";

import { useDomainObject, useDomainObjectState, useKernel, useSdk } from "@kilo-desktop/kernel/web";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { useTrack } from "../../app";
import { packageInstallLinkTelemetry, readPackageInstallLink } from "./package-install-link";
import type { PackageInstallRequest } from "./PackageInstallRequestDialog";

/** An install request taken off the route; `id` tells two requests for one package apart. */
export type TakenPackageInstallRequest = PackageInstallRequest & { readonly id: number };

/**
 * Takes an install link off the window's route once: keeps it as local
 * state, clears it from the route (so back / forward and reloads don't
 * replay it), and tracks it. An invalid link only shows a toast; an
 * unsupported action is only logged.
 *
 * The page mounts this only once the person is signed in and conda is ready,
 * so a link that arrives before then waits on the route.
 */
export function usePackageInstallLink(): readonly [TakenPackageInstallRequest | null, () => void] {
	const windowId = useKernel().window.id;
	const navigation = useDomainObject(Navigation);
	const search = useDomainObjectState(Navigation, (state) => state.windows[windowId]?.search);
	const track = useTrack();
	const { logger } = useSdk();
	const [request, setRequest] = useState<TakenPackageInstallRequest | null>(null);
	const taken = useRef<{ search: string | null; count: number }>({ search: null, count: 0 });

	useEffect(() => {
		const link = search ? readPackageInstallLink(search) : null;
		if (!search || !link) {
			taken.current.search = null;
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
		const { event, data } = packageInstallLinkTelemetry(link);
		track(event, data);

		if (link.kind === "install") {
			taken.current.count += 1;
			setRequest({ ...link, id: taken.current.count });
		} else if (link.reason === "unsupported-action") {
			const action = JSON.stringify((search["packageAction"] ?? "").slice(0, 64));
			logger.warn(`Ignored a packages link with the unsupported action ${action}.`);
		} else {
			toast.error("This install link is invalid.", {
				description: "Check the link on anaconda.org and try again.",
			});
		}
	}, [search, navigation, windowId, track, logger]);

	// Bound to the request it was handed with: a flow a newer link replaced can
	// still finish (an install keeps running) and must not close the newer one.
	const requestId = request?.id;
	const dismiss = () => setRequest((current) => (current?.id === requestId ? null : current));
	return [request, dismiss] as const;
}
