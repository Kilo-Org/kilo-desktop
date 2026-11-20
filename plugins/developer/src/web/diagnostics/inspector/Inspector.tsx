import { Fragment, useEffect, useRef } from "react";
import { ArrowLeftIcon } from "lucide-react";

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@kilo-desktop/ui/components/breadcrumb";
import { Button } from "@kilo-desktop/ui/components/button";

import type { IssueRecord } from "../diagnostics-summary";
import type { EntityRef } from "../domain-model";
import { ContextKeyDetail } from "./ContextKeyDetail";
import { DomainDetail } from "./DomainDetail";
import { FlagDetail } from "./FlagDetail";
import { useNavigation, TrailScope } from "./navigation";
import { ObjectTypeDetail } from "./ObjectTypeDetail";
import { OwnerDetail } from "./OwnerDetail";
import { PointDetail } from "./PointDetail";

function Detail({
	entity,
	issues,
	turnedOff,
}: {
	readonly entity: EntityRef;
	readonly issues: readonly IssueRecord[];
	readonly turnedOff: ReadonlySet<string>;
}) {
	switch (entity.kind) {
		case "point":
			return <PointDetail id={entity.id} />;
		case "domain":
			return <DomainDetail id={entity.id} />;
		case "objectType":
			return <ObjectTypeDetail id={entity.id} />;
		case "contextKey":
			return <ContextKeyDetail id={entity.id} />;
		case "flag":
			return <FlagDetail id={entity.id} />;
		case "owner":
			return <OwnerDetail id={entity.id} issues={issues} turnedOff={turnedOff} />;
	}
}

/** The entity at the end of `trail`, under breadcrumbs back to Diagnostics. */
export function Inspector({
	trail,
	issues,
	turnedOff,
}: {
	readonly trail: readonly EntityRef[];
	readonly issues: readonly IssueRecord[];
	readonly turnedOff: ReadonlySet<string>;
}) {
	const { go } = useNavigation();
	const current = trail.at(-1);
	const currentKey = current ? `${current.kind}:${current.id}` : undefined;
	const root = useRef<HTMLDivElement>(null);
	// A link deep in a long page or detail opens the next one from its top.
	useEffect(() => {
		if (currentKey === undefined) return;
		root.current?.scrollIntoView({ block: "nearest" });
	}, [currentKey]);
	if (!current) return null;
	return (
		<div ref={root} className="flex min-w-0 flex-col gap-4" data-qa-id="diagnostics-inspector">
			<div className="flex min-w-0 items-center gap-2">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Back"
					data-qa-id="diagnostics-back"
					onClick={() => go(trail.slice(0, -1))}
				>
					<ArrowLeftIcon />
				</Button>
				<Breadcrumb className="min-w-0" data-qa-id="diagnostics-breadcrumbs">
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink render={<button type="button" />} onClick={() => go([])}>
								Diagnostics
							</BreadcrumbLink>
						</BreadcrumbItem>
						{trail.map((entity, index) => (
							<Fragment key={`${entity.kind}:${entity.id}`}>
								<BreadcrumbSeparator />
								<BreadcrumbItem className="min-w-0 font-mono text-xs">
									{index === trail.length - 1 ? (
										<BreadcrumbPage className="break-all">{entity.id}</BreadcrumbPage>
									) : (
										<BreadcrumbLink
											render={<button type="button" />}
											className="break-all"
											onClick={() => go(trail.slice(0, index + 1))}
										>
											{entity.id}
										</BreadcrumbLink>
									)}
								</BreadcrumbItem>
							</Fragment>
						))}
					</BreadcrumbList>
				</Breadcrumb>
			</div>
			<TrailScope trail={trail}>
				<Detail
					key={`${current.kind}:${current.id}`}
					entity={current}
					issues={issues}
					turnedOff={turnedOff}
				/>
			</TrailScope>
		</div>
	);
}
