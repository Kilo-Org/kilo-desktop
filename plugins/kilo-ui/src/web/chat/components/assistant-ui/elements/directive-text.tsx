"use client";

import type { FC, ReactNode } from "react";

type IconComponent = FC<{ className?: string }>;

export type DirectiveTextSegment =
	| { readonly kind: "text"; readonly text: string }
	| {
			readonly kind: "mention";
			readonly type: string;
			readonly label: string;
			readonly id: string;
	  };

export type DirectiveTextFormatter = {
	/** Parse text into alternating text and directive segments. */
	parse(text: string): readonly DirectiveTextSegment[];
};

export type CreateDirectiveTextOptions = {
	/** Maps a directive `type` to an icon component. */
	iconMap?: Record<string, IconComponent>;
	/** Icon rendered when `iconMap` has no entry for the segment type. */
	fallbackIcon?: IconComponent;
	/** Resolves an icon from the full directive when its id carries display context. */
	renderIcon?: (segment: Extract<DirectiveTextSegment, { kind: "mention" }>) => ReactNode;
	/** Resolves an action for interactive directive chips. */
	getAction?: (
		segment: Extract<DirectiveTextSegment, { kind: "mention" }>,
	) => (() => void) | undefined;
};

/** Creates a text component that parses directive syntax and renders inline chips. */
export function createDirectiveText(
	formatter: DirectiveTextFormatter,
	options?: CreateDirectiveTextOptions,
): FC<{ text: string }> {
	const iconMap = options?.iconMap;
	const fallbackIcon = options?.fallbackIcon;
	const renderIcon = options?.renderIcon;
	const getAction = options?.getAction;

	const Component: FC<{ text: string }> = ({ text }) => {
		const segments = formatter.parse(text);

		if (segments.length === 1 && segments[0]!.kind === "text") {
			return <>{text}</>;
		}

		return (
			<>
				{segments.map((seg, i) => {
					if (seg.kind === "text") {
						return (
							<span key={i} className="whitespace-pre-wrap">
								{seg.text}
							</span>
						);
					}

					const Icon = iconMap?.[seg.type] ?? fallbackIcon;
					const icon = renderIcon?.(seg);
					const action = getAction?.(seg);
					const content = (
						<>
							{icon ?? (Icon && <Icon />)}
							{seg.label}
						</>
					);
					const chipProps = {
						"data-slot": "directive-text-chip",
						"data-directive-type": seg.type,
						"data-directive-id": seg.id,
						"aria-label": `${seg.type}: ${seg.label}`,
						className: "aui-directive-chip",
					};
					return action ? (
						<button key={i} type="button" {...chipProps} onClick={action}>
							{content}
						</button>
					) : (
						<span key={i} {...chipProps}>
							{content}
						</span>
					);
				})}
			</>
		);
	};
	Component.displayName = "DirectiveText";
	return Component;
}
