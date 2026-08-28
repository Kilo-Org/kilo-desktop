import type { DesktopReleaseNotes } from "@anaconda-agentic-desktop/contracts";
import { Separator } from "@anaconda-agentic-desktop/ui/components/separator";

export function ReleaseNotesList({
	notes,
	showHeading = true,
}: {
	readonly notes: readonly DesktopReleaseNotes[];
	readonly showHeading?: boolean;
}) {
	const visibleNotes = notes.filter((release) => release.items.length > 0);

	return (
		<section aria-label="Release notes">
			{visibleNotes.map((release, releaseIndex) => (
				<div key={release.version}>
					{releaseIndex > 0 ? <Separator className="my-3" /> : null}
					{releaseIndex === 0 && showHeading ? (
						<h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
							What's changed
						</h3>
					) : releaseIndex > 0 ? (
						<code className="text-muted-foreground text-[11px] font-medium">{release.version}</code>
					) : null}
					<ul
						className={`${showHeading || releaseIndex > 0 ? "mt-2" : ""} space-y-1.5 pl-4 text-xs leading-5`}
					>
						{release.items.map((item, itemIndex) => (
							<li className="list-disc break-words" key={`${itemIndex}:${item}`}>
								{item}
							</li>
						))}
					</ul>
				</div>
			))}
		</section>
	);
}
