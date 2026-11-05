import type { DomainState } from "@kilo-desktop/kernel";
import { useDomainState } from "@kilo-desktop/kernel/web";
import { Identity } from "@kilo-desktop/plugin-account/contracts";

const selectAccountKey = (state: DomainState<typeof Identity>) =>
	`${state.authenticated ?? "unknown"}:${state.profile?.currentOrgId ?? ""}`;

/**
 * Who Kilo serves models and agents for: signing in or out, or switching
 * organization, changes which ones it offers. Part of the catalog query keys
 * so those catalogs are read again then, rather than keeping a model the
 * account no longer has.
 */
export function useKiloAccountKey(): string {
	return useDomainState(Identity, selectAccountKey) ?? "";
}
