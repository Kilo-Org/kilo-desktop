import { MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";
import type { FC } from "react";

type PlanMarkdownProps = {
	text: string;
	className?: string;
};

export const PlanMarkdown: FC<PlanMarkdownProps> = ({ text, className }) => {
	return <MarkdownContent className={className} data-slot="plan-markdown" text={text} />;
};
