import {
	resolveOsxNotarize,
	resolveOsxSign,
	resolveWindowsSigning,
	type SigningEnvironment,
} from "./signing.js";

export const DEFAULT_RELEASE_CHANNEL = "canary";
export const RELEASE_PREFIX = "anaconda-agentic-desktop";
export const PUBLISHABLE_RELEASE_CHANNELS = ["canary", "staging", "prod"] as const;

/**
 * Values accepted by `RELEASE_CHANNEL` for packaged builds and publish.
 * Local `pnpm start` / `pnpm dev` is unpackaged development and is not a channel value.
 */
export type PublishableReleaseChannel = (typeof PUBLISHABLE_RELEASE_CHANNELS)[number];

export interface ReleaseEnvironment {
	readonly RELEASE_CHANNEL?: string;
	readonly UPDATE_PUBLISH_URL?: string;
	readonly UPDATE_S3_BUCKET?: string;
}

export type PublishEnvironment = ReleaseEnvironment & SigningEnvironment;

function isPublishableReleaseChannel(channel: string): channel is PublishableReleaseChannel {
	return (PUBLISHABLE_RELEASE_CHANNELS as readonly string[]).includes(channel);
}

export function getReleaseChannel(environment: ReleaseEnvironment = {}): PublishableReleaseChannel {
	const channel = environment.RELEASE_CHANNEL?.trim() || DEFAULT_RELEASE_CHANNEL;
	if (!isPublishableReleaseChannel(channel)) {
		throw new Error(
			`Invalid release channel: ${channel}. Expected one of: ${PUBLISHABLE_RELEASE_CHANNELS.join(", ")}`,
		);
	}
	return channel;
}

export function getUpdatePublishUrl(environment: ReleaseEnvironment = {}): string {
	return environment.UPDATE_PUBLISH_URL?.trim().replace(/\/+$/, "") ?? "";
}

export function getReleasePrefix(channel: string): string {
	return `${RELEASE_PREFIX}/${channel}`;
}

export function getArtifactKey(input: {
	readonly channel: string;
	readonly platform: string;
	readonly arch: string;
	readonly fileName: string;
}): string {
	return `${getReleasePrefix(input.channel)}/${input.platform}/${input.arch}/${input.fileName}`;
}

export function getUpdateFeedUrl(input: {
	readonly publishUrl: string;
	readonly channel: string;
	readonly platform: string;
	readonly arch: string;
}): string | undefined {
	if (!input.publishUrl) return undefined;
	const url = new URL(input.publishUrl);
	if (url.protocol !== "https:") {
		throw new Error("UPDATE_PUBLISH_URL must use HTTPS.");
	}
	return `${url.toString().replace(/\/+$/, "")}/${getReleasePrefix(input.channel)}/${input.platform}/${input.arch}`;
}

function requiresSignedPublish(channel: PublishableReleaseChannel): boolean {
	return channel === "staging" || channel === "prod";
}

export function validatePublishEnvironment(
	environment: PublishEnvironment,
	platform: NodeJS.Platform,
): void {
	if (!environment.UPDATE_S3_BUCKET?.trim()) {
		throw new Error("UPDATE_S3_BUCKET is required to publish releases.");
	}

	const channel = getReleaseChannel(environment);
	if (!requiresSignedPublish(channel)) return;

	if (platform === "darwin" && !(resolveOsxSign(environment) && resolveOsxNotarize(environment))) {
		throw new Error(
			"Staging/production macOS publishing requires a signing identity and notarization credentials (App Store Connect API key or Apple ID).",
		);
	}
	if (platform === "win32" && resolveWindowsSigning(environment).mode === "none") {
		throw new Error(
			"Staging/production Windows publishing requires Azure Key Vault signing credentials or a certificate file.",
		);
	}
}
