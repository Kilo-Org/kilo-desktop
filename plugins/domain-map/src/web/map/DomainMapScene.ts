import {
	box,
	curve,
	cylinder,
	ellipse,
	Group,
	HemisphereLight,
	InstancedMesh,
	Label,
	Lines,
	Mesh,
	sphere,
	View,
	type Curve,
	type Hit,
	type TooltipContent,
} from "phoria2";

import type { Activity } from "./activity";
import { layoutDomainMap as layoutOf } from "./layout";
import { deliveryOf, usersOf, type DomainMap, type MapDomain } from "./model";
import { describePicked, type Pickable } from "./tooltip";
import { Traffic } from "./traffic";

export const MAP_COLORS = {
	background: "#0b1020",
	event: "#4cc9f0",
	state: "#f5a623",
	domain: "#b9c3ff",
	unprovided: "#4a5068",
	mainPlatform: "#2b3a67",
	windowPlatform: "#24564a",
	/** A plugin declaring it uses a domain object. */
	use: "#9ef0c8",
	mirror: "#f5a8e0",
	/** An extension point, and the plugins contributing to it. */
	point: "#ffd27a",
	plane: "#8090c0",
} as const;

const PULSE_CAPACITY = 400;
const LINK_OPACITY = 0.35;
const DIMMED_LINK_OPACITY = 0.05;
const FRAME_PADDING = 0.05;
/** Lower than phoria2's "perspective" preset, so the process planes read as stacked layers. */
const CAMERA_DIRECTION: [number, number, number] = [0.45, 0.3, 1];
/**
 * Share of a flash spent in the delivery's colour before snapping back:
 * blending lavender into amber passes through a muddy tan, so it never blends.
 */
const FLASH_HOLD = 0.35;
/** Mirrors are drawn as ghosts of the domain object they copy. */
const MIRROR_OPACITY = 0.8;

/** A sphere on the map: a domain object, or a mirror of one. */
interface MapNode {
	readonly mesh: InstancedMesh;
	readonly index: number;
	readonly position: readonly [number, number, number];
	readonly color: string;
}

export interface DomainMapSceneOptions {
	readonly onSelect: (domainId: string | null) => void;
	readonly labelClassName: string;
	readonly planeLabelClassName: string;
	readonly tooltipClassName: string;
}

/**
 * Draws a {@link DomainMap} with phoria2 and animates what domain objects do
 * on it. A main domain object's event or state change travels to the plugins
 * declaring they use it beside it, and down to its mirror in this window (a
 * ghost sphere on the window's kernel) and only then on to the window
 * plugins using it.
 *
 * Owns one View for the canvas's lifetime. `show` rebuilds the drawn content
 * only when the map's shape changed, keeping the camera where the user left
 * it. Traffic is advanced from the View's frame loop, so a paused or idle map
 * costs nothing.
 */
export class DomainMapScene {
	readonly #view: View;
	readonly #options: DomainMapSceneOptions;
	readonly #traffic = new Traffic({ capacity: PULSE_CAPACITY });
	readonly #pulses: InstancedMesh;
	#content: Group | null = null;
	#map: DomainMap | null = null;
	#shape = "";
	#curves = new Map<string, Curve>();
	/** Every drawn line, with the domain objects (and mirrors) it involves, for selection. */
	#lines = new Map<
		string,
		{
			readonly line: Lines;
			readonly involves: readonly string[];
			/** Uses can be shown only while something travels them; copies and feeds always show. */
			readonly transient: boolean;
		}
	>();
	#onlyActive = false;
	#nodes = new Map<string, MapNode>();
	#wasFlashing = new Set<string>();
	#selected: string | null = null;
	#platforms: InstancedMesh | null = null;
	#showPlugins = true;
	#paused = false;
	#shownPulses = 0;
	#framed = false;

	constructor(canvas: HTMLCanvasElement, options: DomainMapSceneOptions) {
		this.#options = options;
		this.#view = new View({
			canvas,
			orbit: true,
			background: MAP_COLORS.background,
			highlight: "#ffffff",
			bloom: { strength: 0.6, radius: 0.4, threshold: 0.6 },
		});
		this.#view.scene.add(
			new HemisphereLight({ sky: "#c8d4ff", ground: "#1a1a2a", intensity: 1.4 }),
		);
		this.#pulses = this.#view.scene.add(
			new InstancedMesh({
				geometry: sphere({ radius: 0.09, segments: 12, rings: 8 }),
				material: { unlit: true, blending: "additive" },
				count: PULSE_CAPACITY,
				pickable: false,
			}),
		);
		for (let index = 0; index < PULSE_CAPACITY; index += 1) {
			this.#pulses.setInstance(index, { scale: 0 });
		}
		this.#view.tooltip((hit) => this.#tooltip(hit), { className: options.tooltipClassName });
		this.#view.on("click", (hit) => {
			const picked = pickedFrom(hit);
			const domainId =
				picked?.kind === "domain"
					? picked.domain.id
					: picked?.kind === "mirror"
						? picked.mirror.domainId
						: null;
			this.select(domainId);
			this.#options.onSelect(this.#selected);
		});
		this.#view.start((dt) => this.#tick(dt));
	}

	show(map: DomainMap): void {
		this.#map = map;
		const shape = shapeOf(map);
		if (shape === this.#shape) return;
		this.#shape = shape;
		this.#rebuild(map);
		if (!this.#framed && map.domains.length > 0) {
			this.#framed = true;
			this.#view.frame(undefined, { direction: CAMERA_DIRECTION, padding: FRAME_PADDING });
		}
	}

	/** Animates what a domain object did; returns how many plugins declare they use it. */
	deliver(activity: Activity): number {
		if (!this.#map) return 0;
		const drawn = (line: { readonly key: string }) => this.#curves.has(line.key);
		const { direct, mirror, relayed } = deliveryOf(this.#map, activity.domainId);
		const users = usersOf(this.#map, activity.domainId).length;
		if (this.#paused || !this.#nodes.has(activity.domainId)) return users;
		const toMirror = mirror && drawn(mirror) ? [mirror] : [];
		this.#traffic.send(activity.domainId, activity.kind, [...direct.filter(drawn), ...toMirror]);
		if (toMirror.length > 0) {
			this.#traffic.send(mirror!.key, activity.kind, relayed.filter(drawn), {
				after: this.#traffic.travelSeconds,
			});
		}
		return users;
	}

	select(domainId: string | null): void {
		this.#selected = domainId && this.#nodes.has(domainId) ? domainId : null;
		this.#paintLines();
	}

	/** Show uses only while something travels them (the selected object's always show). */
	set onlyActive(on: boolean) {
		this.#onlyActive = on;
		this.#paintLines();
	}

	#paintLines(): void {
		const selected = this.#selected;
		const lit = this.#onlyActive ? this.#traffic.litLinks() : undefined;
		for (const [key, { line, involves, transient }] of this.#lines) {
			const involved =
				!selected || involves.some((id) => id === selected || id === `mirror:${selected}`);
			let opacity = involved ? (selected ? 0.9 : LINK_OPACITY) : DIMMED_LINK_OPACITY;
			if (lit && transient && !(selected && involved)) {
				// Lit lines show brighter than resting ones, so the path stands out.
				opacity = (lit.get(key) ?? 0) * 0.9;
			}
			line.visible = opacity > 0;
			line.material.opacity = opacity;
		}
	}

	set paused(paused: boolean) {
		this.#paused = paused;
		if (paused) this.#traffic.clear();
	}

	/** Plugin platforms: hide them to see just the domain objects. */
	set showPlugins(on: boolean) {
		this.#showPlugins = on;
		if (this.#platforms) this.#platforms.visible = on;
	}

	set autoRotate(on: boolean) {
		if (this.#view.controls) this.#view.controls.autoRotate = on ? 0.15 : false;
	}

	resetCamera(): void {
		this.#view.frame(undefined, {
			direction: "perspective",
			padding: FRAME_PADDING,
			duration: 0.6,
		});
	}

	dispose(): void {
		this.#view.dispose();
	}

	#rebuild(map: DomainMap): void {
		this.#content?.removeFromParent();
		this.#content?.dispose();
		this.#traffic.clear();
		const layout = layoutOf(map);
		const content = new Group({ name: "domain-map" });

		for (const plane of layout.planes) {
			content.add(
				new Mesh({
					geometry: cylinder({ radius: plane.radius, height: 0.02, segments: 96 }),
					material: { color: MAP_COLORS.plane, unlit: true, opacity: 0.05 },
					position: [0, plane.y - 0.08, 0],
					pickable: false,
				}),
				new Lines({
					geometry: ellipse({ radius: plane.radius, center: [0, plane.y - 0.07, 0] }).line({
						segments: 128,
					}),
					material: { color: MAP_COLORS.plane, opacity: 0.35, width: 1 },
					pickable: false,
				}),
				new Label({
					text: plane.process === "main" ? "Main process" : "This window",
					position: [0, plane.y, plane.radius],
					className: this.#options.planeLabelClassName,
					place: "below",
					priority: 10,
				}),
			);
		}

		const platforms = new InstancedMesh({
			geometry: cylinder({ radius: 1, height: 0.12, segments: 48 }),
			material: { roughness: 0.6, metalness: 0.1 },
			data: map.plugins.map((plugin): Pickable => ({ kind: "plugin", plugin })),
			labels: {
				text: (row: Pickable) => (row.kind === "plugin" ? row.plugin.name : null),
				place: "below",
				className: this.#options.labelClassName,
				priority: 5,
			},
		});
		for (const [index, plugin] of map.plugins.entries()) {
			const placed = layout.plugins.get(plugin.key)!;
			platforms.setInstance(index, {
				position: [...placed.position],
				scale: [placed.radius, 1, placed.radius],
				color: plugin.process === "main" ? MAP_COLORS.mainPlatform : MAP_COLORS.windowPlatform,
			});
		}
		platforms.visible = this.#showPlugins;
		this.#platforms = platforms;
		content.add(platforms);

		this.#nodes = new Map();
		this.#wasFlashing = new Set();
		const domains = new InstancedMesh({
			geometry: sphere({ radius: 0.2, segments: 24, rings: 16 }),
			material: { roughness: 0.35, metalness: 0.2 },
			data: map.domains.map((domain): Pickable => ({ kind: "domain", domain })),
			labels: {
				text: (row: Pickable) => (row.kind === "domain" ? shortName(row.domain.id) : null),
				place: "above",
				className: this.#options.labelClassName,
				minScale: 28,
				priority: 1,
			},
		});
		for (const [index, domain] of map.domains.entries()) {
			const position = layout.domains.get(domain.id)!;
			const color = domainColor(domain);
			domains.setInstance(index, { position: [...position], color });
			this.#nodes.set(domain.id, { mesh: domains, index, position, color });
		}
		content.add(domains);

		if (map.mirrors.length > 0) {
			const mirrors = new InstancedMesh({
				geometry: sphere({ radius: 0.18, segments: 24, rings: 16 }),
				material: { roughness: 0.2, metalness: 0.1, opacity: MIRROR_OPACITY },
				data: map.mirrors.map((mirror): Pickable => ({ kind: "mirror", mirror })),
				labels: {
					text: (row: Pickable) => (row.kind === "mirror" ? shortName(row.mirror.domainId) : null),
					place: "above",
					className: this.#options.labelClassName,
					minScale: 28,
					priority: 1,
				},
			});
			for (const [index, mirror] of map.mirrors.entries()) {
				const position = layout.domains.get(mirror.key)!;
				mirrors.setInstance(index, { position: [...position], color: MAP_COLORS.mirror });
				this.#nodes.set(mirror.key, { mesh: mirrors, index, position, color: MAP_COLORS.mirror });
			}
			content.add(mirrors);
		}

		this.#curves = new Map();
		this.#lines = new Map();
		for (const mirror of map.mirrors) {
			const points = layout.links.get(mirror.key);
			if (!points) continue;
			const path = curve(
				points.map((point) => [...point]),
				{ tension: 0 },
			);
			this.#curves.set(mirror.key, path);
			const line = new Lines({
				geometry: path.line({ segments: 32 }),
				material: { color: MAP_COLORS.mirror, opacity: LINK_OPACITY, width: 1.5, dash: 0.12 },
				arrows: "end",
				data: { kind: "mirror", mirror } satisfies Pickable,
			});
			this.#lines.set(mirror.key, { line, involves: [mirror.domainId], transient: false });
			content.add(line);
		}
		for (const use of map.uses) {
			const points = layout.links.get(use.key);
			if (!points) continue;
			const path = curve(
				points.map((point) => [...point]),
				{ tension: 0 },
			);
			this.#curves.set(use.key, path);
			const line = new Lines({
				geometry: path.line({ segments: 32 }),
				material: { color: MAP_COLORS.use, opacity: LINK_OPACITY, width: 1.5 },
				arrows: "end",
				data: { kind: "use", use } satisfies Pickable,
			});
			this.#lines.set(use.key, { line, involves: [use.domainId], transient: true });
			content.add(line);
		}

		if (map.points.length > 0) {
			const points = new InstancedMesh({
				geometry: box(0.17),
				material: { roughness: 0.35, metalness: 0.3 },
				data: map.points.map((point): Pickable => ({ kind: "point", point })),
				labels: {
					text: (row: Pickable) => (row.kind === "point" ? shortName(row.point.pointId) : null),
					place: "below",
					className: this.#options.labelClassName,
					minScale: 28,
					priority: 2,
				},
			});
			for (const [index, point] of map.points.entries()) {
				points.setInstance(index, {
					position: [...layout.points.get(point.key)!],
					rotation: [Math.PI / 4, 0, Math.PI / 4],
					color: MAP_COLORS.point,
				});
			}
			content.add(points);
		}

		for (const feed of map.feeds) {
			const path = layout.links.get(feed.key);
			if (!path) continue;
			const line = new Lines({
				geometry: curve(
					path.map((point) => [...point]),
					{ tension: 0 },
				).line({ segments: 24 }),
				material: { color: MAP_COLORS.point, opacity: LINK_OPACITY, width: 1.2 },
				arrows: "end",
				data: { kind: "feed", feed } satisfies Pickable,
			});
			// Structure, like the copy lines: shown even when only active lines are.
			this.#lines.set(feed.key, { line, involves: [], transient: false });
			content.add(line);
		}

		this.#content = this.#view.scene.add(content);
		this.select(this.#selected);
	}

	#tick(dt: number): void {
		if (this.#traffic.idle && this.#shownPulses === 0 && this.#wasFlashing.size === 0) return;
		this.#traffic.advance(dt);
		const pulses = this.#traffic.pulses();
		let shown = 0;
		for (const pulse of pulses) {
			const path = this.#curves.get(pulse.linkKey);
			if (!path) continue;
			this.#pulses.setInstance(shown, {
				position: path.at(pulse.t),
				scale: 1 + 0.6 * Math.sin(Math.PI * pulse.t),
				color: MAP_COLORS[pulse.kind],
			});
			shown += 1;
		}
		for (let index = shown; index < this.#shownPulses; index += 1) {
			this.#pulses.setInstance(index, { scale: 0 });
		}
		this.#shownPulses = shown;
		this.#paintFlashes();
		if (this.#onlyActive) this.#paintLines();
	}

	#paintFlashes(): void {
		const flashing = new Map(this.#traffic.flashes().map((flash) => [flash.domainId, flash]));
		for (const key of new Set([...flashing.keys(), ...this.#wasFlashing])) {
			const node = this.#nodes.get(key);
			if (!node) continue;
			const flash = flashing.get(key);
			node.mesh.setInstance(node.index, {
				position: [...node.position],
				scale: 1 + (flash ? 0.7 * flash.strength : 0),
				color: flash && flash.strength > FLASH_HOLD ? MAP_COLORS[flash.kind] : node.color,
			});
		}
		this.#wasFlashing = new Set(flashing.keys());
	}

	#tooltip(hit: Hit): TooltipContent {
		const picked = pickedFrom(hit);
		return picked && this.#map ? describePicked(this.#map, picked) : null;
	}
}

function pickedFrom(hit: Hit | null): Pickable | null {
	const datum = hit?.datum as Pickable | undefined;
	return datum && typeof datum === "object" && "kind" in datum ? datum : null;
}

/** What decides whether the map has to be redrawn (not just re-coloured). */
function shapeOf(map: DomainMap): string {
	return JSON.stringify([
		map.domains.map((d) => [d.id, d.provided]),
		map.plugins.map((p) => p.key),
		map.uses.map((u) => u.key),
		map.mirrors.map((m) => m.key),
		map.points.map((p) => p.key),
		map.feeds.map((f) => f.key),
	]);
}

const shortName = (id: string) => id.slice(id.indexOf("/") + 1);

const domainColor = (domain: MapDomain) =>
	domain.provided ? MAP_COLORS.domain : MAP_COLORS.unprovided;
