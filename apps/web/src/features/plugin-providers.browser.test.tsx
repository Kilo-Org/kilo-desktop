import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ReactNode } from "react";

import { PluginProviderStack, type PluginProviderContribution } from "./plugin-providers";

afterEach(cleanup);

function provider(id: string) {
	return function TestProvider({ children }: { children: ReactNode }) {
		return <div data-qa-id={id}>{children}</div>;
	};
}

function contribution(
	pluginId: string,
	priority: number,
	browserSafe = true,
): PluginProviderContribution {
	return {
		pluginId,
		component: provider(pluginId),
		priority,
		browserSafe,
	};
}

describe("PluginProviderStack", () => {
	it("orders providers by priority with higher priority outermost", () => {
		const { baseElement } = render(
			<PluginProviderStack
				providers={[contribution("low", 1), contribution("high", 10)]}
				desktopAvailable={false}
			>
				<span data-qa-id="content">Content</span>
			</PluginProviderStack>,
		);

		const high = baseElement.querySelector('[data-qa-id="high"]');
		const low = baseElement.querySelector('[data-qa-id="low"]');
		const content = baseElement.querySelector('[data-qa-id="content"]');
		expect(high?.contains(low)).toBe(true);
		expect(low?.contains(content)).toBe(true);
	});

	it("mounts Electron-only providers only when the desktop bridge is available", () => {
		const electronOnly = contribution("electron-only", 0, false);
		const { baseElement, rerender } = render(
			<PluginProviderStack providers={[electronOnly]} desktopAvailable={false}>
				<span>Content</span>
			</PluginProviderStack>,
		);
		expect(baseElement.querySelector('[data-qa-id="electron-only"]')).toBeNull();

		rerender(
			<PluginProviderStack providers={[electronOnly]} desktopAvailable>
				<span>Content</span>
			</PluginProviderStack>,
		);
		expect(baseElement.querySelector('[data-qa-id="electron-only"]')).not.toBeNull();
	});
});
