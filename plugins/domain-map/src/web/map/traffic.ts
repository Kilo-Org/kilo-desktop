export type TrafficKind = "event" | "state";

export interface TrafficOptions {
	/** Most pulses in flight; the oldest go first. */
	readonly capacity?: number;
	readonly travelSeconds?: number;
	readonly flashSeconds?: number;
	/** How long a link stays lit after the last thing on it arrives. */
	readonly lingerSeconds?: number;
}

interface Pulse {
	readonly linkKey: string;
	readonly kind: TrafficKind;
	/** Negative until it starts. */
	age: number;
}

interface Flash {
	readonly key: string;
	readonly kind: TrafficKind;
	/** Negative until it starts. */
	age: number;
}

const easeOut = (t: number) => 1 - (1 - t) ** 2;

/**
 * What is moving on the map: a pulse travelling down each link a delivery
 * took, and a flash on the node (domain object or mirror) it left from. A
 * relayed hop can start `after` the hop before it, so a delivery visibly
 * travels domain object → mirror → listeners. Advanced by the scene's frame
 * loop; knows nothing about drawing.
 */
export class Traffic {
	readonly #capacity: number;
	readonly #travel: number;
	readonly #flash: number;
	readonly #linger: number;
	/** Links something finished travelling, by seconds since it arrived. */
	readonly #lingering = new Map<string, number>();
	#pulses: Pulse[] = [];
	#flashes: Flash[] = [];

	constructor({
		capacity = 400,
		travelSeconds = 1.1,
		flashSeconds = 0.8,
		lingerSeconds = 0.6,
	}: TrafficOptions = {}) {
		this.#capacity = capacity;
		this.#travel = travelSeconds;
		this.#flash = flashSeconds;
		this.#linger = lingerSeconds;
	}

	get idle(): boolean {
		return this.#pulses.length === 0 && this.#flashes.length === 0 && this.#lingering.size === 0;
	}

	/** How long a pulse takes down a link: a relayed hop starts this much later. */
	get travelSeconds(): number {
		return this.#travel;
	}

	send(
		from: string,
		kind: TrafficKind,
		links: readonly { readonly key: string }[],
		{ after = 0 }: { readonly after?: number } = {},
	): void {
		this.#flashes.push({ key: from, kind, age: -after });
		this.#pulses.push(...links.map((link) => ({ linkKey: link.key, kind, age: -after })));
		if (this.#pulses.length > this.#capacity) {
			this.#pulses = this.#pulses.slice(-this.#capacity);
		}
	}

	advance(seconds: number): void {
		for (const [key, age] of this.#lingering) {
			if (age + seconds >= this.#linger) this.#lingering.delete(key);
			else this.#lingering.set(key, age + seconds);
		}
		for (const pulse of this.#pulses) pulse.age += seconds;
		for (const pulse of this.#pulses) {
			const overshoot = pulse.age - this.#travel;
			if (overshoot >= 0 && overshoot < this.#linger) this.#lingering.set(pulse.linkKey, overshoot);
		}
		this.#pulses = this.#pulses.filter((pulse) => pulse.age < this.#travel);
		for (const flash of this.#flashes) flash.age += seconds;
		this.#flashes = this.#flashes.filter((flash) => flash.age < this.#flash);
	}

	/** Each pulse with how far along its link it is, 0 to 1. */
	pulses(): { linkKey: string; kind: TrafficKind; t: number }[] {
		return this.#pulses
			.filter((pulse) => pulse.age >= 0)
			.map(({ linkKey, kind, age }) => ({ linkKey, kind, t: easeOut(age / this.#travel) }));
	}

	/** Each flashing node, by its latest flash to have started, with how bright it still is, 1 to 0. */
	flashes(): { domainId: string; kind: TrafficKind; strength: number }[] {
		const latest = new Map<string, Flash>();
		for (const flash of this.#flashes) {
			if (flash.age < 0) continue;
			const current = latest.get(flash.key);
			if (!current || flash.age <= current.age) latest.set(flash.key, flash);
		}
		return [...latest.values()].map(({ key, kind, age }) => ({
			domainId: key,
			kind,
			strength: 1 - age / this.#flash,
		}));
	}

	/** Links something is travelling (1), or fading out after it arrived (1 to 0). */
	litLinks(): Map<string, number> {
		const lit = new Map<string, number>();
		for (const [key, age] of this.#lingering) lit.set(key, 1 - age / this.#linger);
		for (const pulse of this.#pulses) if (pulse.age >= 0) lit.set(pulse.linkKey, 1);
		return lit;
	}

	clear(): void {
		this.#lingering.clear();
		this.#pulses = [];
		this.#flashes = [];
	}
}
