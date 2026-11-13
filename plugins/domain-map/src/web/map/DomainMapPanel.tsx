import { useState } from "react";
import { RotateCcwIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Label } from "@kilo-desktop/ui/components/label";
import { Switch } from "@kilo-desktop/ui/components/switch";

import type { ActivityEntry } from "./activity-log";
import { MAP_COLORS } from "./DomainMapScene";
import { usersOf, type DomainMap, type MapDomain } from "./model";
import { ActivityLine, Legend, MapCounts, MapStage } from "./parts";
import { mapPreferences, useMapPreferences, type MapPreferencesState } from "./preferences";
import { useLiveDomainMap } from "./useLiveDomainMap";

type Switchable = keyof Pick<
	MapPreferencesState,
	| "live"
	| "showState"
	| "includeUnprovided"
	| "rotate"
	| "showPlugins"
	| "showPoints"
	| "onlyActive"
>;

const SWITCHES: readonly {
	readonly id: string;
	readonly key: Switchable;
	readonly label: string;
}[] = [
	{ id: "animate", key: "live", label: "Live" },
	{ id: "state", key: "showState", label: "State changes" },
	{ id: "only-active", key: "onlyActive", label: "Only active lines" },
	{ id: "points", key: "showPoints", label: "Extension points" },
	{ id: "plugins", key: "showPlugins", label: "Plugins" },
	{ id: "unprovided", key: "includeUnprovided", label: "Not provided" },
	{ id: "rotate", key: "rotate", label: "Rotate" },
];

function Toggle({
	id,
	label,
	checked,
	onChange,
}: {
	readonly id: string;
	readonly label: string;
	readonly checked: boolean;
	readonly onChange: (checked: boolean) => void;
}) {
	return (
		<Label className="text-muted-foreground text-xs font-normal">
			<Switch
				size="sm"
				checked={checked}
				onCheckedChange={onChange}
				data-qa-id={`domain-map-${id}`}
			/>
			{label}
		</Label>
	);
}

function SelectedDomain({
	domain,
	map,
	onClose,
}: {
	readonly domain: MapDomain;
	readonly map: DomainMap;
	readonly onClose: () => void;
}) {
	const users = usersOf(map, domain.id);
	return (
		<section
			className="flex shrink-0 flex-col gap-1.5 border-b p-3"
			data-qa-id="domain-map-selected"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<h3 className="truncate font-mono text-xs font-medium" title={domain.id}>
						{domain.id}
					</h3>
					<p className="text-muted-foreground text-xs">
						Shipped by {domain.owner}, lives in {domain.process === "main" ? "main" : "this window"}
					</p>
				</div>
				<Button variant="ghost" size="xs" onClick={onClose} data-qa-id="domain-map-deselect">
					Close
				</Button>
			</div>
			{domain.description ? <p className="text-xs">{domain.description}</p> : null}
			<p className="text-muted-foreground text-xs" data-qa-id="domain-map-selected-users">
				{users.length
					? `Used by (declared) ${users.join(", ")}`
					: "No plugin declares it uses this."}
			</p>
			<p className="text-muted-foreground text-xs">
				Events: {domain.events.length ? domain.events.join(", ") : "none"}
			</p>
			{map.mirrors.some((mirror) => mirror.domainId === domain.id) ? (
				<p className="text-muted-foreground text-xs" data-qa-id="domain-map-selected-mirror">
					<span style={{ color: MAP_COLORS.mirror }}>Mirrored into this window.</span> The window's
					kernel keeps a copy in step with main; method calls go back to main.
				</p>
			) : null}
		</section>
	);
}

function LiveLog({
	entries,
	filter,
	onPick,
}: {
	readonly entries: readonly ActivityEntry[];
	readonly filter: string | null;
	readonly onPick: (domainId: string) => void;
}) {
	const shown = filter ? entries.filter((entry) => entry.domainId === filter) : entries;
	return (
		<section className="flex min-h-0 flex-1 flex-col">
			<h3 className="border-b px-3 py-1.5 text-xs font-medium">
				Live activity{filter ? " for the selected object" : ""}
			</h3>
			<ol className="min-h-0 flex-1 overflow-y-auto" data-qa-id="domain-map-log">
				{shown.length === 0 ? (
					<li className="text-muted-foreground px-3 py-2 text-xs">Waiting for activity…</li>
				) : null}
				{shown.map((entry) => (
					<li key={entry.id} className="border-b last:border-b-0">
						<button
							type="button"
							className="hover:bg-muted flex w-full flex-col gap-0.5 px-3 py-1.5 text-left text-xs"
							onClick={() => onPick(entry.domainId)}
							data-qa-id="domain-map-log-entry"
						>
							<ActivityLine entry={entry} />
							{entry.payload ? (
								<span className="text-muted-foreground truncate font-mono">{entry.payload}</span>
							) : null}
						</button>
					</li>
				))}
			</ol>
		</section>
	);
}

/**
 * The Domain Map, in kilo.shell's right sidebar so it can be watched beside
 * whatever the person is doing: the app as domain objects. Each plugin is a
 * platform in the process it runs in, carrying the domain objects it owns
 * and the extension points it offers; a line runs from a domain object to
 * each plugin that declares it uses it, and from each contributor to a
 * point. Every state change and event of the domain objects this window can
 * see travels down those lines as it happens. Lines are what plugins
 * declare (their manifests), not who actually listens: the kernel doesn't
 * tell plugins that.
 */
export function DomainMapPanel() {
	const preferences = useMapPreferences();
	const [selected, setSelected] = useState<string | null>(null);
	const { canvasRef, scene, failure, map, entries } = useLiveDomainMap({
		selected,
		onSelect: setSelected,
	});
	const selectedDomain = map.domains.find((domain) => domain.id === selected) ?? null;

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-qa-id="domain-map-panel">
			<div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2">
				{SWITCHES.map(({ id, key, label }) => (
					<Toggle
						key={id}
						id={id}
						label={label}
						checked={preferences[key]}
						onChange={(on) => mapPreferences.set({ [key]: on })}
					/>
				))}
				<Button
					variant="ghost"
					size="icon-xs"
					className="ml-auto"
					title="Reset view"
					aria-label="Reset view"
					disabled={!scene}
					onClick={() => scene?.resetCamera()}
					data-qa-id="domain-map-reset"
				>
					<RotateCcwIcon />
				</Button>
			</div>
			<MapStage canvasRef={canvasRef} failure={failure} className="min-h-[280px] flex-[3]">
				<MapCounts map={map} />
				<Legend map={map} />
			</MapStage>
			<div className="flex min-h-[160px] flex-[2] flex-col border-t">
				{selectedDomain ? (
					<SelectedDomain domain={selectedDomain} map={map} onClose={() => setSelected(null)} />
				) : (
					<p
						className="text-muted-foreground shrink-0 border-b px-3 py-2 text-xs"
						data-qa-id="domain-map-hint"
					>
						Drag to orbit, scroll to zoom. Click a domain object to see who uses it; hover anything
						for details.
					</p>
				)}
				<LiveLog entries={entries} filter={selectedDomain?.id ?? null} onPick={setSelected} />
			</div>
		</div>
	);
}
