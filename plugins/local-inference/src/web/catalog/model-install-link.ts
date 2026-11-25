import { LOCAL_INFERENCE_TELEMETRY_EVENTS, MODEL_INSTALL_DEEP_LINK } from "../../contracts/index";

/**
 * A web catalog's "Install via Desktop" link
 * (`kilo-desktop://models/install?model=…[&file=…]`), as kilo.shell hands it
 * to the settings page: the action as `modelAction`, the rest as search
 * parameters. The link comes from a web page, so every identifier is checked
 * before it is used.
 */
export type ModelInstallLink =
	| {
			readonly kind: "install";
			readonly model: string;
			readonly file?: string;
			readonly source?: string;
	  }
	| {
			readonly kind: "invalid";
			readonly reason: ModelInstallLinkRejection;
			readonly source?: string;
	  };

export type ModelInstallLinkRejection =
	| "unsupported-action"
	| "missing-model"
	| "invalid-model"
	| "invalid-file";

const LINK_PARAMS = [MODEL_INSTALL_DEEP_LINK.pathParam, ...MODEL_INSTALL_DEEP_LINK.query];

/** A safe catalog identifier (UUID or slug): printable ASCII, no path separators or whitespace. */
const CATALOG_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** The sources telemetry reports by name; any other is `other`. */
const KNOWN_SOURCES = new Set(["dot-org"]);

/** Reads a model install link from the window's search; null when the search holds none. */
export function readModelInstallLink(
	search: Readonly<Record<string, string>>,
): ModelInstallLink | null {
	if (!LINK_PARAMS.some((name) => search[name] !== undefined)) return null;

	const source = optional(search["source"]);
	const invalid = (reason: ModelInstallLinkRejection): ModelInstallLink => ({
		kind: "invalid",
		reason,
		...(source ? { source } : {}),
	});

	if (search[MODEL_INSTALL_DEEP_LINK.pathParam] !== "install") {
		return invalid("unsupported-action");
	}

	const model = optional(search["model"]);
	if (!model) return invalid("missing-model");
	if (!isCatalogId(model)) return invalid("invalid-model");

	const file = optional(search["file"]);
	if (file && !isCatalogId(file)) return invalid("invalid-file");

	return {
		kind: "install",
		model,
		...(file ? { file } : {}),
		...(source ? { source } : {}),
	};
}

/** The telemetry event for a link: booleans and codes only, never a model or file id. */
export function modelInstallLinkTelemetry(link: ModelInstallLink): {
	event: string;
	data: Record<string, unknown>;
} {
	const source = !link.source ? "none" : KNOWN_SOURCES.has(link.source) ? link.source : "other";
	if (link.kind === "invalid") {
		return {
			event: LOCAL_INFERENCE_TELEMETRY_EVENTS.modelInstallLinkRejected,
			data: { reason: link.reason, source },
		};
	}
	return {
		event: LOCAL_INFERENCE_TELEMETRY_EVENTS.modelInstallLinkReceived,
		data: {
			hasFile: link.file !== undefined,
			source,
		},
	};
}

function optional(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function isCatalogId(value: string): boolean {
	return CATALOG_ID.test(value) && !value.includes("..");
}
