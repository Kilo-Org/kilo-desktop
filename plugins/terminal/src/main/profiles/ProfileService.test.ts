import { describe, expect, it, vi } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";

import type { CustomTerminalProfile, TerminalProfile } from "../../contracts/profiles";
import type { ShellCandidate } from "../sessions/shell-launch";
import { ProfileService, type ShellDiscovery } from "./ProfileService";

const FISH: TerminalProfile = {
	id: "detected:fish",
	label: "fish",
	path: "/opt/homebrew/bin/fish",
	args: [],
	source: "detected",
	available: true,
};
const ZSH: TerminalProfile = { ...FISH, id: "detected:zsh", label: "zsh", path: "/bin/zsh" };
const AUTOMATIC: ShellCandidate[] = [
	{ shell: "/bin/zsh", args: [] },
	{ shell: "/bin/bash", args: [] },
];

/** Detection reporting the custom profiles whose shells "exist". */
function discovery(found: TerminalProfile[] = [FISH, ZSH], existing: readonly string[] = []) {
	return {
		detect: vi.fn(async (custom: readonly CustomTerminalProfile[]) => [
			...found,
			...custom
				.filter((profile) => existing.includes(profile.id))
				.map((profile): TerminalProfile => ({
					id: profile.id,
					label: profile.label,
					path: `/resolved/${profile.path ?? profile.source}`,
					args: profile.args ?? [],
					...(profile.env ? { env: profile.env } : {}),
					source: "custom",
					available: true,
				})),
		]),
		automatic: vi.fn(async () => AUTOMATIC),
	} satisfies ShellDiscovery;
}

function service(
	options: { storage?: ReturnType<typeof createMemoryStorage>; shells?: ShellDiscovery } = {},
) {
	const warnings: unknown[][] = [];
	const profiles = new ProfileService({
		storage: options.storage ?? createMemoryStorage("/data/kilo.terminal"),
		discovery: options.shells ?? discovery(),
		logger: { warn: (...args: unknown[]) => void warnings.push(args) },
	});
	return { profiles, warnings };
}

describe("ProfileService", () => {
	it("keeps settings across restarts", () => {
		const storage = createMemoryStorage("/data/kilo.terminal");
		const first = service({ storage }).profiles;
		expect(first.settings()).toEqual({ defaultProfileId: null, customProfiles: [] });
		first.updateSettings({
			defaultProfileId: "detected:fish",
			customProfiles: [{ id: "nu", label: "Nushell", path: "nu" }],
		});

		expect(service({ storage }).profiles.settings()).toEqual({
			defaultProfileId: "detected:fish",
			customProfiles: [{ id: "nu", label: "Nushell", path: "nu" }],
		});
	});

	it("launches the default profile first, then the automatic shells", async () => {
		const { profiles } = service({ shells: discovery([FISH, ZSH], ["login-fish"]) });
		profiles.updateSettings({
			defaultProfileId: "login-fish",
			customProfiles: [
				{ id: "login-fish", label: "Login fish", path: "fish", args: ["-l"], env: { A: "1" } },
			],
		});

		expect(await profiles.resolveLaunch()).toEqual([
			{ shell: "/resolved/fish", args: ["-l"], env: { A: "1" } },
			...AUTOMATIC,
		]);
	});

	it("doesn't repeat the default among the automatic shells", async () => {
		const { profiles } = service();
		profiles.updateSettings({ defaultProfileId: "detected:zsh" });
		expect(await profiles.resolveLaunch()).toEqual([
			{ shell: "/bin/zsh", args: [] },
			{ shell: "/bin/bash", args: [] },
		]);
	});

	it("launches automatically, without detecting, when no default is chosen", async () => {
		const shells = discovery();
		const { profiles } = service({ shells });
		expect(await profiles.resolveLaunch()).toEqual(AUTOMATIC);
		expect(shells.detect).not.toHaveBeenCalled();
	});

	it("falls back to automatic shells, with a warning, when the default isn't found", async () => {
		const { profiles, warnings } = service();
		profiles.updateSettings({
			defaultProfileId: "gone",
			customProfiles: [{ id: "gone", label: "Gone", path: "/nowhere/sh" }],
		});

		expect(await profiles.resolveLaunch()).toEqual(AUTOMATIC);
		expect(warnings).toHaveLength(1);
		expect(await profiles.profiles()).toContainEqual({
			id: "gone",
			label: "Gone",
			path: "/nowhere/sh",
			args: [],
			source: "custom",
			available: false,
		});
	});

	it("detects once for concurrent callers until refreshed, and retries a failed run", async () => {
		const shells = discovery();
		const { profiles } = service({ shells });
		await Promise.all([profiles.profiles(), profiles.profiles()]);
		expect(shells.detect).toHaveBeenCalledTimes(1);

		await profiles.refresh();
		expect(shells.detect).toHaveBeenCalledTimes(2);

		shells.detect.mockRejectedValueOnce(new Error("probe crashed"));
		await expect(profiles.refresh()).rejects.toThrow("probe crashed");
		expect(await profiles.profiles()).toEqual([FISH, ZSH]);
		expect(shells.detect).toHaveBeenCalledTimes(4);
	});

	it("detects again with the new custom profiles once they change", async () => {
		const shells = discovery();
		const { profiles } = service({ shells });
		await profiles.profiles();
		profiles.updateSettings({ customProfiles: [{ id: "nu", label: "Nushell", path: "nu" }] });
		await profiles.profiles();
		expect(shells.detect).toHaveBeenLastCalledWith([{ id: "nu", label: "Nushell", path: "nu" }]);
		profiles.updateSettings({ defaultProfileId: "detected:fish" });
		await profiles.profiles();
		expect(shells.detect).toHaveBeenCalledTimes(2);
	});

	it("goes back to automatic when the default custom profile is removed", () => {
		const { profiles } = service();
		profiles.updateSettings({
			defaultProfileId: "nu",
			customProfiles: [{ id: "nu", label: "Nushell", path: "nu" }],
		});
		expect(profiles.updateSettings({ customProfiles: [] })).toEqual({
			defaultProfileId: null,
			customProfiles: [],
		});
	});

	it("refuses custom profiles sharing an id", () => {
		const { profiles } = service();
		expect(() =>
			profiles.updateSettings({
				customProfiles: [
					{ id: "a", label: "One", path: "zsh" },
					{ id: "a", label: "Two", path: "bash" },
				],
			}),
		).toThrow("Two custom profiles share the id");
		expect(profiles.settings().customProfiles).toEqual([]);
	});

	it("ignores saved custom profiles that are no longer valid", () => {
		const storage = createMemoryStorage("/data/kilo.terminal");
		storage.kv<Record<string, unknown>>({ namespace: "terminal-settings", defaults: {} }).set({
			defaultProfileId: 42,
			customProfiles: [
				{ id: "ok", label: "OK", path: "zsh" },
				{ id: "bad", label: "Bad", path: "bin/zsh" },
			],
		});
		expect(service({ storage }).profiles.settings()).toEqual({
			defaultProfileId: null,
			customProfiles: [{ id: "ok", label: "OK", path: "zsh" }],
		});
	});
});
