import {
	channelSchema,
	ENVIRONMENTS_TELEMETRY_EVENTS,
	matchSpecSchema,
	PACKAGE_INSTALL_DEEP_LINK,
	repodataPackageNameSchema,
} from "../../../contracts/index";

/**
 * anaconda.org's "Install via Desktop" link
 * (`kilo-desktop://packages/install?package=…`), as kilo.shell hands it to
 * the settings page: the action as `packageAction`, the rest as search
 * parameters. The link comes from a web page, so everything in it is checked
 * before it reaches conda.
 */
export type PackageInstallLink =
	| {
			readonly kind: "install";
			/** The package name. */
			readonly package: string;
			readonly version?: string;
			/** What to install: `name`, or `name=version`. */
			readonly spec: string;
			readonly channel?: string;
			readonly source?: string;
	  }
	| {
			readonly kind: "invalid";
			readonly reason: PackageInstallLinkRejection;
			readonly source?: string;
	  };

export type PackageInstallLinkRejection =
	| "unsupported-action"
	| "missing-package"
	| "invalid-package"
	| "invalid-version"
	| "invalid-channel";

const LINK_PARAMS = [PACKAGE_INSTALL_DEEP_LINK.pathParam, ...PACKAGE_INSTALL_DEEP_LINK.query];

/** A plain conda package name: no version, build, channel or namespace. */
const PACKAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** A single exact version (`1.26.4`, `1!2.0+cpu`): no operators, globs or whitespace. */
const EXACT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+!]*$/;

/**
 * anaconda.org's `main` is Anaconda's `defaults` main; conda reads a bare
 * `main` as `<channel_alias>/main`, a different channel.
 */
const ANACONDA_ORG_CHANNELS: Readonly<Record<string, string>> = { main: "pkgs/main" };

/** The sources telemetry reports by name; any other is `other`. */
const KNOWN_SOURCES = new Set(["dot-org"]);

/** Reads an install link from the window's search; null when the search holds none. */
export function readPackageInstallLink(
	search: Readonly<Record<string, string>>,
): PackageInstallLink | null {
	if (!LINK_PARAMS.some((name) => search[name] !== undefined)) return null;

	const source = optional(search["source"]);
	const invalid = (reason: PackageInstallLinkRejection): PackageInstallLink => ({
		kind: "invalid",
		reason,
		...(source ? { source } : {}),
	});

	if (search[PACKAGE_INSTALL_DEEP_LINK.pathParam] !== "install")
		return invalid("unsupported-action");

	const name = optional(search["package"]);
	if (!name) return invalid("missing-package");
	if (!isPackageName(name)) return invalid("invalid-package");

	const version = optional(search["version"]);
	if (version && !EXACT_VERSION.test(version)) return invalid("invalid-version");
	const spec = version ? `${name}=${version}` : name;
	if (!matchSpecSchema.safeParse(spec).success) return invalid("invalid-version");

	const requested = optional(search["channel"]);
	const channel = requested ? (ANACONDA_ORG_CHANNELS[requested] ?? requested) : undefined;
	if (channel && !isWebLinkChannel(channel)) return invalid("invalid-channel");

	return {
		kind: "install",
		package: name,
		...(version ? { version } : {}),
		spec,
		...(channel ? { channel } : {}),
		...(source ? { source } : {}),
	};
}

/** The telemetry event for a link: booleans and codes only, never a package or channel. */
export function packageInstallLinkTelemetry(link: PackageInstallLink): {
	event: string;
	data: Record<string, unknown>;
} {
	const source = !link.source ? "none" : KNOWN_SOURCES.has(link.source) ? link.source : "other";
	if (link.kind === "invalid") {
		return {
			event: ENVIRONMENTS_TELEMETRY_EVENTS.packageInstallLinkRejected,
			data: { reason: link.reason, source },
		};
	}
	return {
		event: ENVIRONMENTS_TELEMETRY_EVENTS.packageInstallLinkReceived,
		data: {
			hasVersion: link.version !== undefined,
			hasChannel: link.channel !== undefined,
			source,
		},
	};
}

function optional(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function isPackageName(name: string): boolean {
	return (
		PACKAGE_NAME.test(name) &&
		repodataPackageNameSchema.safeParse(name).success &&
		matchSpecSchema.safeParse(name).success
	);
}

/** A channel conda accepts that is not on this device: a web page must not point conda at local files. */
function isWebLinkChannel(channel: string): boolean {
	if (!channelSchema.safeParse(channel).success) return false;
	return !(
		/^file:/i.test(channel) ||
		channel.startsWith("/") ||
		channel.startsWith("~") ||
		channel.startsWith(".") ||
		/^[a-z]:[\\/]/i.test(channel)
	);
}
