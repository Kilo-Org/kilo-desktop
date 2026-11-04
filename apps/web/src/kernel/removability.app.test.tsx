// Principle 5 (docs/plugin-architecture.md): removing any bundled plugin
// leaves the app booting. Boots the window with every bundled plugin's real
// renderer entry except the removed one (and plugins that `require` it), over
// a main kernel holding the same manifests (browser mode: no main entries;
// apps/desktop/src/main/kernel/plugins.removability.test.ts boots those), and
// checks every remaining plugin activates and the window renders: kilo.shell's
// frame, or the kernel's recovery screen when kilo.shell itself is removed.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { BUNDLED_PLUGINS, withEntries, type BundledPlugin } from "@kilo-desktop/bundled-plugins";
import { entriesWithout, pluginRemovals } from "@kilo-desktop/bundled-plugins/testing";
import type { KernelLogger } from "@kilo-desktop/kernel";
import { createTestKernelPair, type TestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider, KernelRoot } from "@kilo-desktop/kernel/web";

import { WEB_ENTRIES } from "./plugins";

const SHELL_ID = "kilo.shell";

const booted: TestKernelPair[] = [];

afterEach(async () => {
	cleanup();
	for (const pair of booted.splice(0)) {
		await pair.renderer.deactivate();
		await pair.main.stop();
	}
});

async function boot(plugins: readonly BundledPlugin[], removedIds: readonly string[]) {
	window.location.hash = "#/";
	localStorage.clear();
	const errors: string[] = [];
	const logger: KernelLogger = {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: (message) => void errors.push(message),
	};
	const pair = await createTestKernelPair({
		main: withEntries({}, plugins),
		renderer: withEntries(entriesWithout(WEB_ENTRIES, removedIds), plugins),
		logger,
	});
	booted.push(pair);
	render(
		<KernelProvider kernel={pair.renderer}>
			<KernelRoot />
		</KernelProvider>,
	);
	return { pair, errors };
}

async function expectBooted(
	{ pair, errors }: Awaited<ReturnType<typeof boot>>,
	options: { readonly expected: number; readonly shell: boolean },
) {
	await expect
		.element(page.getByTestId(options.shell ? "shell-main" : "kernel-recovery"), {
			timeout: 10_000,
		})
		.toBeVisible();
	const states = pair.renderer.pluginStates();
	expect(pair.renderer.issues().filter((issue) => issue.severity === "error")).toEqual([]);
	expect(errors).toEqual([]);
	expect(Object.keys(states)).toHaveLength(options.expected);
	// A plugin behind a manifest `when` (a feature flag, off here) waits `inactive`.
	const notRunning = Object.entries(states).filter(
		([id, state]) =>
			state !== "active" && !(state === "inactive" && pair.renderer.manifest(id)?.when),
	);
	expect(notRunning).toEqual([]);
}

// A full window per case; generous so a loaded CI worker doesn't flake.
describe("bundled plugins in the window", { timeout: 30_000 }, () => {
	it("boot together", async () => {
		await expectBooted(await boot(BUNDLED_PLUGINS, []), {
			expected: BUNDLED_PLUGINS.length,
			shell: true,
		});
	});

	it.each(pluginRemovals(BUNDLED_PLUGINS))(
		"boot without $removed",
		async ({ removedIds, remaining }) => {
			await expectBooted(await boot(remaining, removedIds), {
				expected: remaining.length,
				shell: !removedIds.includes(SHELL_ID),
			});
		},
	);
});
