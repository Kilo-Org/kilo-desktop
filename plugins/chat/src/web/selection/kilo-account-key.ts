import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObjectState } from "@kilo-desktop/kernel/web";
import { KiloAccount } from "@kilo-desktop/plugin-core/contracts";

const selectAccountKey = (state: DomainObjectState<typeof KiloAccount>) =>
	`${state.signedIn ?? "unknown"}:${state.profile?.currentOrgId ?? ""}`;

/**
 * Who Kilo serves agents for: signing in or out, or switching organization,
 * changes which ones it offers. Part of the agent catalog's query key so it
 * is read again then.
 */
export function useKiloAccountKey(): string {
	return useDomainObjectState(KiloAccount, selectAccountKey) ?? "";
}
