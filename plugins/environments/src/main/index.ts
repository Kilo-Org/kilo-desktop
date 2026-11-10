import { createEnvironmentsMainEntry } from "./entry";

export { createEnvironmentsMainEntry, type EnvironmentsMainOptions } from "./entry";

const bridgeSentryDsn: string | undefined = import.meta.env.VITE_BRIDGE_SENTRY_DSN;

/** kilo.environments' main entry, on the bundled conda bridge. */
export const environmentsMainEntry = createEnvironmentsMainEntry(
	bridgeSentryDsn ? { sentryDsn: bridgeSentryDsn } : {},
);
