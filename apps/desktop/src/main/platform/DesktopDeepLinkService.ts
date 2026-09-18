import type { PluginDeepLink } from "@kilo-desktop/feature-sdk";

import {
	findDesktopDeepLink,
	parseDesktopDeepLink,
	type DeepLinkNavigation,
} from "./desktop-deep-link.js";

export interface DesktopDeepLinkHost {
	readonly scheme: string;
	readonly links: readonly PluginDeepLink[];
	registerProtocolClient(scheme: string): void;
	onOpenUrl(listener: (url: string) => void): () => void;
	onSecondInstance(listener: (commandLine: readonly string[]) => void): () => void;
	argv(): readonly string[];
	hasWindow(): boolean;
	reveal(): void;
	replaceLoadingUrl(target: DeepLinkNavigation): void;
	navigate(target: DeepLinkNavigation): void;
}

/**
 * Owns OS-level `kilo-desktop://` / `kilo-desktop-dev://` deep links.
 * Plugin manifests contribute hosts (`contributes.deepLinks`); matching URLs
 * become in-app hash navigations. Links that arrive before the main window
 * exists are queued as its initial route; links during load replace that URL;
 * links after the renderer is live are pushed over `shell:navigate`. Unknown
 * hosts and paths are ignored.
 */
export class DesktopDeepLinkService {
	#pending: DeepLinkNavigation | undefined;
	#windowReady = false;
	readonly #disposers: Array<() => void> = [];

	constructor(private readonly host: DesktopDeepLinkHost) {}

	start(): void {
		this.host.registerProtocolClient(this.host.scheme);
		this.#disposers.push(
			this.host.onOpenUrl((url) => this.#handleUrl(url)),
			this.host.onSecondInstance((commandLine) => {
				this.host.reveal();
				this.#handleArgv(commandLine);
			}),
		);
		this.#handleArgv(this.host.argv());
	}

	takeInitialRoute(): DeepLinkNavigation | undefined {
		const pending = this.#pending;
		this.#pending = undefined;
		return pending;
	}

	markWindowReady(): void {
		this.#windowReady = true;
		if (!this.#pending) return;
		this.host.navigate(this.#pending);
		this.#pending = undefined;
	}

	markWindowClosed(): void {
		this.#windowReady = false;
	}

	dispose(): void {
		for (const dispose of this.#disposers.splice(0).reverse()) dispose();
	}

	#handleUrl(url: string): void {
		const navigation = parseDesktopDeepLink(url, this.host.links);
		if (!navigation) return;
		this.#apply(navigation);
	}

	#handleArgv(argv: readonly string[]): void {
		const navigation = findDesktopDeepLink(argv, this.host.links);
		if (!navigation) return;
		this.#apply(navigation);
	}

	#apply(target: DeepLinkNavigation): void {
		if (this.host.hasWindow() && this.#windowReady) {
			this.host.reveal();
			this.host.navigate(target);
			return;
		}
		if (this.host.hasWindow()) {
			this.host.replaceLoadingUrl(target);
			return;
		}
		this.#pending = target;
	}
}
