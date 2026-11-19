/**
 * Owns the terminal's shell profiles: the person's settings (default profile
 * and custom profiles, in kv) and the cached result of detecting the shells
 * installed. Detection is slow on Windows (it walks install folders and asks
 * wsl.exe), so it runs at most once at a time: concurrent callers share one
 * in-flight promise, which is kept until `refresh()` or a change to the custom
 * profiles replaces it; a failed run is dropped so the next caller retries.
 * Detection waits for `ready` (the login shell's environment), so PATH lookups
 * see the person's PATH. The constructor does no I/O.
 *
 * `resolveLaunch()` is read at every shell start: the default profile, when it
 * is found, then the automatic shells. With no default chosen it skips
 * detection entirely. A default that can't be found falls back to automatic
 * with a warning; its custom profile stays listed as unavailable so Settings
 * can say so. Removing the custom profile that is the default resets the
 * default to automatic.
 */
import {
	KernelError,
	type KernelLogger,
	type KvStore,
	type PluginStorage,
} from "@kilo-desktop/kernel";

import {
	customTerminalProfileSchema,
	DEFAULT_TERMINAL_SETTINGS,
	TERMINAL_PROFILE_SOURCE_LABELS,
	type CustomTerminalProfile,
	type TerminalProfile,
	type TerminalSettings,
} from "../../contracts/profiles";
import type { ShellCandidate } from "../sessions/shell-launch";

/** How main finds shells: detected profiles, and the automatic fallbacks that exist. */
export interface ShellDiscovery {
	detect(customProfiles: readonly CustomTerminalProfile[]): Promise<TerminalProfile[]>;
	automatic(): Promise<ShellCandidate[]>;
}

export interface ProfileServiceOptions {
	readonly storage: Pick<PluginStorage, "kv">;
	readonly discovery: ShellDiscovery;
	/** Settles once the process environment is complete; detection waits for it. */
	readonly ready?: () => Promise<void>;
	readonly logger?: Pick<KernelLogger, "warn">;
}

type SettingsPatch = { readonly [K in keyof TerminalSettings]?: TerminalSettings[K] | undefined };

interface PersistedSettings extends Record<string, unknown> {
	defaultProfileId: unknown;
	customProfiles: unknown;
}

export class ProfileService {
	readonly #store: KvStore<PersistedSettings>;
	readonly #discovery: ShellDiscovery;
	readonly #ready: () => Promise<void>;
	readonly #logger: Pick<KernelLogger, "warn">;
	#detection: Promise<TerminalProfile[]> | null = null;

	constructor(options: ProfileServiceOptions) {
		this.#store = options.storage.kv<PersistedSettings>({
			namespace: "terminal-settings",
			defaults: { ...DEFAULT_TERMINAL_SETTINGS },
		});
		this.#discovery = options.discovery;
		this.#ready = options.ready ?? (() => Promise.resolve());
		this.#logger = options.logger ?? { warn: () => undefined };
	}

	settings(): TerminalSettings {
		const { defaultProfileId, customProfiles } = this.#store.snapshot();
		return {
			defaultProfileId:
				typeof defaultProfileId === "string" && defaultProfileId.length > 0
					? defaultProfileId
					: null,
			customProfiles: Array.isArray(customProfiles)
				? customProfiles.flatMap((profile) => {
						const parsed = customTerminalProfileSchema.safeParse(profile);
						return parsed.success ? [parsed.data] : [];
					})
				: [],
		};
	}

	updateSettings(patch: SettingsPatch): TerminalSettings {
		const current = this.settings();
		const customProfiles = patch.customProfiles ?? current.customProfiles;
		const ids = customProfiles.map((profile) => profile.id);
		const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
		if (duplicate !== undefined) {
			throw new KernelError("VALIDATION", `Two custom profiles share the id "${duplicate}".`);
		}
		let defaultProfileId =
			patch.defaultProfileId === undefined ? current.defaultProfileId : patch.defaultProfileId;
		const wasCustom = current.customProfiles.some((profile) => profile.id === defaultProfileId);
		if (wasCustom && !ids.includes(defaultProfileId!)) defaultProfileId = null;

		const next: TerminalSettings = { defaultProfileId, customProfiles };
		if (JSON.stringify(customProfiles) !== JSON.stringify(current.customProfiles)) {
			this.#detection = null;
		}
		this.#store.set(next);
		return next;
	}

	/** Every profile: those found, then custom ones whose shell wasn't (unavailable). */
	profiles(): Promise<TerminalProfile[]> {
		if (!this.#detection) {
			const detection = this.#detect();
			this.#detection = detection;
			detection.catch(() => {
				if (this.#detection === detection) this.#detection = null;
			});
		}
		return this.#detection;
	}

	refresh(): Promise<TerminalProfile[]> {
		this.#detection = null;
		return this.profiles();
	}

	async resolveLaunch(): Promise<ShellCandidate[]> {
		const { defaultProfileId } = this.settings();
		const automatic = await this.#discovery.automatic();
		if (defaultProfileId === null) return automatic;
		const profile = (await this.profiles()).find(
			(candidate) => candidate.id === defaultProfileId && candidate.available,
		);
		if (!profile) {
			this.#logger.warn(
				`The default terminal profile "${defaultProfileId}" wasn't found; starting a shell automatically.`,
			);
			return automatic;
		}
		const chosen: ShellCandidate = {
			shell: profile.path,
			args: profile.args,
			...(profile.env ? { env: profile.env } : {}),
		};
		return [chosen, ...automatic.filter((candidate) => candidate.shell !== chosen.shell)];
	}

	async #detect(): Promise<TerminalProfile[]> {
		await this.#ready();
		const { customProfiles } = this.settings();
		const found = await this.#discovery.detect(customProfiles);
		const foundIds = new Set(found.map((profile) => profile.id));
		const missing = customProfiles
			.filter((profile) => !foundIds.has(profile.id))
			.map((profile): TerminalProfile => ({
				id: profile.id,
				label: profile.label,
				path: profile.path ?? TERMINAL_PROFILE_SOURCE_LABELS[profile.source!],
				args: profile.args ?? [],
				...(profile.env ? { env: profile.env } : {}),
				source: "custom",
				available: false,
			}));
		return [...found, ...missing];
	}
}
