export const DEFAULT_RELEASE_CHANNEL = "canary";
export const RELEASE_PREFIX = "anaconda-agentic-desktop";

export interface ReleaseEnvironment {
	readonly APPLE_APP_SPECIFIC_PASSWORD?: string;
	readonly APPLE_ID?: string;
	readonly APPLE_SIGNING_IDENTITY?: string;
	readonly APPLE_TEAM_ID?: string;
	readonly RELEASE_CHANNEL?: string;
	readonly UPDATE_PUBLISH_URL?: string;
	readonly UPDATE_S3_BUCKET?: string;
	readonly WINDOWS_CERTIFICATE_FILE?: string;
	readonly WINDOWS_CERTIFICATE_PASSWORD?: string;
}

export function getReleaseChannel(environment: ReleaseEnvironment = {}): string {
	const channel = environment.RELEASE_CHANNEL?.trim() || DEFAULT_RELEASE_CHANNEL;
	if (!/^[a-z0-9][a-z0-9._-]*$/i.test(channel)) {
		throw new Error(`Invalid release channel: ${channel}`);
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

export function validatePublishEnvironment(
	environment: ReleaseEnvironment,
	platform: NodeJS.Platform,
): void {
	if (!environment.UPDATE_S3_BUCKET?.trim()) {
		throw new Error("UPDATE_S3_BUCKET is required to publish releases.");
	}
	if (getReleaseChannel(environment) !== "prod") return;

	if (
		platform === "darwin" &&
		(!environment.APPLE_SIGNING_IDENTITY?.trim() ||
			!environment.APPLE_ID?.trim() ||
			!environment.APPLE_APP_SPECIFIC_PASSWORD?.trim() ||
			!environment.APPLE_TEAM_ID?.trim())
	) {
		throw new Error("Production macOS publishing requires signing and notarization credentials.");
	}
	if (
		platform === "win32" &&
		(!environment.WINDOWS_CERTIFICATE_FILE?.trim() || !environment.WINDOWS_CERTIFICATE_PASSWORD)
	) {
		throw new Error("Production Windows publishing requires certificate credentials.");
	}
}
