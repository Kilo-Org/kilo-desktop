import type { DetailValue } from "../diagnostics-summary";
import type { KeyUse } from "../domain-model";
import { Details, Panel } from "../parts";
import { ownerValue } from "./PointDetail";

function describeUse(use: KeyUse): DetailValue {
	const expected = `needs ${use.key} ${use.expected ? "on" : "off"}`;
	return use.contribution
		? {
				code: use.contribution,
				...(use.pointId ? { link: { kind: "point", id: use.pointId } } : {}),
				note: `${use.pointId ? `contributes to ${use.pointId}; ` : ""}${expected}`,
			}
		: { ...ownerValue(use.pluginId), note: `runs only while it holds; ${expected}` };
}

/** Plugins and contributions whose `when` reads a context key. */
export function KeyUses({
	title,
	uses,
	empty,
}: {
	readonly title: string;
	readonly uses: readonly KeyUse[];
	readonly empty: string;
}) {
	return (
		<Panel title={title} testId="diagnostics-key-uses">
			<Details
				className="border-t-0"
				items={[
					{
						label: "Conditions",
						values: uses.length > 0 ? uses.map(describeUse) : [{ text: empty }],
					},
				]}
			/>
		</Panel>
	);
}
