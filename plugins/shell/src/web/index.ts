import { createElement } from "react";
import { KeyboardIcon, PaletteIcon } from "lucide-react";

import { definePlugin, KernelCommand, KernelRoot, KernelWindows } from "@kilo-desktop/kernel";

import { Navigation, OnboardingStep, SettingsSection } from "../contracts";
import { provideNavigation, routeDeepLinks } from "./navigation";
import { featuresStep } from "./onboarding/features-step";
import { createShellRouter } from "./router";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { ShortcutsSettings } from "./shortcuts/ShortcutsSettings";
import { ShellRoot } from "./ShellRoot";
import { startThemeRuntime } from "./theme-runtime";
import { createShellUiState } from "./ui-state";

/**
 * kilo.shell's renderer entry. Every window gets the theme runtime and the
 * shell's settings sections; the main window also gets the router, frame,
 * navigation and deep-link routing.
 */
export const shellWebEntry = definePlugin({
	activate(sdk) {
		startThemeRuntime(sdk);

		sdk.extensions.implement(OnboardingStep, "features", featuresStep);
		sdk.extensions.implement(SettingsSection, "appearance", {
			component: AppearanceSettings,
			icon: PaletteIcon,
		});
		sdk.extensions.implement(SettingsSection, "keyboard-shortcuts", {
			component: ShortcutsSettings,
			icon: KeyboardIcon,
		});

		// Bound only in secondary windows (its `when`); there ⌘W closes the window itself.
		sdk.extensions.implement(KernelCommand, "close-window", () => {
			if (!sdk.windowId) return;
			return sdk.domains.get(KernelWindows)?.methods.close({ windowId: sdk.windowId });
		});

		if (sdk.context.get("kernel/secondaryWindow")) return;

		const router = createShellRouter();
		const ui = createShellUiState();
		provideNavigation(sdk, router);
		routeDeepLinks(sdk);
		sdk.extensions.implement(KernelRoot, "frame", function ShellFrame() {
			return createElement(ShellRoot, { router, ui });
		});

		const navigation = () => sdk.domains.get(Navigation);
		sdk.extensions.implement(KernelCommand, "open-settings", () =>
			navigation()?.methods.openSettings({}),
		);
		sdk.extensions.implement(KernelCommand, "go-home", () =>
			navigation()?.methods.goHome(undefined),
		);
		sdk.extensions.implement(KernelCommand, "toggle-sidebar", () => ui.toggleSidebar());
		sdk.extensions.implement(KernelCommand, "command-palette", () =>
			ui.setPaletteOpen(!ui.isPaletteOpen()),
		);
		sdk.extensions.implement(KernelCommand, "show-shortcuts", () =>
			ui.setShortcutsOpen(!ui.isShortcutsOpen()),
		);
	},
});
