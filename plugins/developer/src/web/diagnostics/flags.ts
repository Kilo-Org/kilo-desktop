import { KernelFlags, type DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObjectState } from "@kilo-desktop/kernel/web";

const selectFlags = (state: DomainObjectState<typeof KernelFlags>) => state;

/** `kernel/flags` as main evaluated it; undefined while this window doesn't see it. */
export function useFlags(): DomainObjectState<typeof KernelFlags> | undefined {
	return useDomainObjectState(KernelFlags, selectFlags);
}

export const FLAG_ORIGIN_TEXT: Readonly<Record<string, string>> = {
	default: "The declared default: no override, and the flag source didn't set it",
	source: "The flag source (kernel/flag-source) evaluated it for the identity",
	override: "The host's overrides (VITE_FEATURE_FLAG_OVERRIDES), ahead of the flag source",
};
