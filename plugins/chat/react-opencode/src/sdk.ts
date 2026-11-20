// Upstream imports `@opencode-ai/sdk/v2/client`; this fork talks to the Kilo v1
// server, whose SDK is the same client under Kilo names.
export * from "@kilocode/sdk/v2/client";

export {
	createKiloClient as createOpencodeClient,
	KiloClient as OpencodeClient,
} from "@kilocode/sdk/v2/client";

export type { KiloClientConfig as OpencodeClientConfig } from "@kilocode/sdk/v2/client";
