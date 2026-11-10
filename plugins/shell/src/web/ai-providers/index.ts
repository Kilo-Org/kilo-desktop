import type { PluginSdk } from "@kilo-desktop/kernel";

/**
 * AI providers: the list, connect and custom-provider dialogs of Settings →
 * AI Providers, over `kilo.core/models`. The settings area renders
 * `AiProviderList` itself, so there is nothing to register.
 */
export function activateAiProviders(_sdk: PluginSdk): void {}
