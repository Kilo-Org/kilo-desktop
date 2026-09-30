import { CheckIcon, CpuIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { ProviderIcon } from "../chat/model-selection/provider-icon.js";

type Feature = {
	id: string;
	title: string;
	description: string;
	className: string;
	art: ReactNode;
};

const FEATURES: readonly Feature[] = [
	{
		id: "any-model",
		title: "Use any model from any provider",
		description:
			"Sign in with Kilo or bring your own keys, then switch between models mid-conversation.",
		className: "md:col-span-2",
		art: <ProvidersArt />,
	},
	{
		id: "local-models",
		title: "Local models",
		description: "Run open models on your own machine, private and offline.",
		className: "",
		art: <LocalModelsArt />,
	},
	{
		id: "layouts",
		title: "Customizable chat layouts",
		description: "Split chats into tiles and tab groups, side by side or stacked.",
		className: "",
		art: <LayoutArt />,
	},
	{
		id: "notebooks",
		title: "Interactive Python notebooks",
		description:
			"The agent writes and runs code in live notebooks beside your chat, so every result is inspectable.",
		className: "md:col-span-2",
		art: <NotebookArt />,
	},
];

/** Closing slide: a bento grid of headline capabilities. */
export function FeaturesStep() {
	return (
		<div data-qa-id="onboarding-features" className="grid grid-cols-1 gap-4 md:grid-cols-3">
			{FEATURES.map((feature, index) => (
				<motion.article
					key={feature.id}
					data-qa-id={`onboarding-feature-${feature.id}`}
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 + index * 0.08 }}
					className={cn(
						"bg-foreground/3 hover:bg-foreground/5 flex flex-col overflow-hidden rounded-[20px] transition-[background-color,translate] duration-300 hover:-translate-y-0.5",
						feature.className,
					)}
				>
					<div
						aria-hidden="true"
						className="bg-foreground/3 relative flex h-32 items-center justify-center overflow-hidden px-6"
					>
						{feature.art}
					</div>
					<div className="flex flex-col gap-1 px-4 py-3">
						<h3 className="text-sm font-medium">{feature.title}</h3>
						<p className="text-muted-foreground text-xs leading-snug">{feature.description}</p>
					</div>
				</motion.article>
			))}
		</div>
	);
}

/** Labs and hosts, one strip each; names make the marks recognisable at a glance. */
const PROVIDER_ROWS = [
	[
		["anthropic", "Anthropic"],
		["openai", "OpenAI"],
		["gemini", "Google"],
		["xai", "xAI"],
		["mistral", "Mistral"],
		["deepseek", "DeepSeek"],
		["moonshot", "Moonshot"],
		["alibaba", "Qwen"],
	],
	[
		["openrouter", "OpenRouter"],
		["groq", "Groq"],
		["together", "Together"],
		["perplexity", "Perplexity"],
		["nvidia", "NVIDIA"],
		["bedrock", "Bedrock"],
		["vertexai", "Vertex AI"],
		["ollama", "Ollama"],
		["lmstudio", "LM Studio"],
		["huggingface", "Hugging Face"],
	],
] as const;

/** Each strip holds two copies of its row and slides by half its length, so the loop is seamless. */
const ROW_COPIES = 2;

/**
 * Two slow strips of provider chips drifting in opposite directions; marks use
 * the mono variant to stay in the neutral palette. The drift is a Web Animation
 * on `transform`, so it runs on the compositor with no per-frame JavaScript;
 * reduced motion leaves the rows still.
 */
function ProvidersArt() {
	return (
		<div className="flex w-full flex-col gap-2.5 mask-x-from-80% mask-x-to-100%">
			{PROVIDER_ROWS.map((row, rowIndex) => (
				<DriftingRow key={rowIndex} providers={row} index={rowIndex} />
			))}
		</div>
	);
}

function DriftingRow({
	providers,
	index,
}: {
	providers: readonly (readonly [provider: string, label: string])[];
	index: number;
}) {
	const rowRef = useRef<HTMLDivElement>(null);
	const reduceMotion = useReducedMotion() === true;

	useEffect(() => {
		const row = rowRef.current;
		if (!row || reduceMotion) return;
		const animation = row.animate(
			[{ transform: "translateX(0)" }, { transform: "translateX(-50%)" }],
			{
				duration: (90 + index * 20) * 1000,
				iterations: Infinity,
				easing: "linear",
				direction: index % 2 === 0 ? "normal" : "reverse",
			},
		);
		return () => animation.cancel();
	}, [index, reduceMotion]);

	return (
		<div ref={rowRef} className="flex w-max will-change-transform">
			{Array.from({ length: ROW_COPIES }, () => providers)
				.flat()
				.map(([provider, label], chip) => (
					<span
						key={`${provider}-${chip}`}
						className="bg-foreground/5 text-muted-foreground mr-2 flex h-9 shrink-0 items-center gap-2 rounded-full pr-3.5 pl-3 text-xs"
					>
						<ProviderIcon provider={provider} variant="mono" size={15} />
						{label}
					</span>
				))}
		</div>
	);
}

const LOCAL_MODELS = [
	{ name: "llama-3.1-8b", size: "4.9 GB" },
	{ name: "qwen2.5-coder-7b", size: "4.7 GB" },
] as const;

function LocalModelsArt() {
	return (
		<div className="bg-background flex w-full max-w-60 flex-col gap-1.5 rounded-2xl p-2.5 shadow-lg shadow-black/20">
			<div className="text-muted-foreground flex items-center justify-between text-[11px] font-medium">
				<span className="flex items-center gap-1.5">
					<CpuIcon className="size-3.5" />
					On this device
				</span>
				<span className="flex items-center gap-1">
					<span className="bg-muted-foreground size-1.5 rounded-full" />
					Ready
				</span>
			</div>
			{LOCAL_MODELS.map((model) => (
				<div
					key={model.name}
					className="bg-foreground/5 flex items-center justify-between gap-2 rounded-lg px-2 py-1 font-mono text-[11px]"
				>
					<span className="truncate">{model.name}</span>
					<span className="text-muted-foreground shrink-0">{model.size}</span>
				</div>
			))}
		</div>
	);
}

type PaneId = "chat" | "notebook" | "changes";

/** Arrangements the canvas cycles through, as CSS grid templates. */
const LAYOUTS: readonly { areas: string; columns: string; rows: string }[] = [
	{ areas: '"chat notebook" "chat changes"', columns: "1.3fr 1fr", rows: "1fr 1fr" },
	{ areas: '"chat chat" "notebook changes"', columns: "1fr 1fr", rows: "1.2fr 1fr" },
	{ areas: '"chat notebook changes"', columns: "1.2fr 1fr 1fr", rows: "1fr" },
	{ areas: '"notebook chat" "changes chat"', columns: "1fr 1.3fr", rows: "1fr 1fr" },
];
const LAYOUT_INTERVAL_MS = 3200;

/**
 * A tiled pane canvas that rearranges itself: a chat, a notebook, and a
 * changes pane, each with its own tab group, reflow between side-by-side,
 * stacked, and mixed splits. Holds the first arrangement under reduced motion.
 */
function LayoutArt() {
	const reduceMotion = useReducedMotion() === true;
	const [index, setIndex] = useState(0);
	const layout = LAYOUTS[index]!;

	useEffect(() => {
		if (reduceMotion) return;
		const timer = window.setInterval(
			() => setIndex((current) => (current + 1) % LAYOUTS.length),
			LAYOUT_INTERVAL_MS,
		);
		return () => window.clearInterval(timer);
	}, [reduceMotion]);

	return (
		<div
			className="bg-background grid h-28 w-full max-w-60 gap-1.5 rounded-2xl p-1.5 shadow-lg shadow-black/20"
			style={{
				gridTemplateAreas: layout.areas,
				gridTemplateColumns: layout.columns,
				gridTemplateRows: layout.rows,
			}}
		>
			{(["chat", "notebook", "changes"] as const).map((pane) => (
				<motion.div
					key={pane}
					layout
					transition={{ type: "spring", stiffness: 260, damping: 30 }}
					className={cn(
						"flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg",
						pane === "chat" ? "bg-foreground/8" : "bg-foreground/4",
					)}
					style={{ gridArea: pane }}
				>
					<motion.div layout="position" className="flex shrink-0 gap-1 px-1.5 pt-1.5">
						<span
							className={cn(
								"h-1 w-4 rounded-full",
								pane === "chat" ? "bg-foreground/30" : "bg-foreground/15",
							)}
						/>
						<span className="bg-foreground/10 h-1 w-2.5 rounded-full" />
					</motion.div>
					<motion.div layout="position" className="min-h-0 flex-1 p-1.5">
						<PaneBody pane={pane} />
					</motion.div>
				</motion.div>
			))}
		</div>
	);
}

function PaneBody({ pane }: { pane: PaneId }) {
	switch (pane) {
		case "chat":
			return (
				<div className="flex flex-col gap-1">
					<span className="bg-foreground/25 h-1 w-4/5 rounded-full" />
					<span className="bg-foreground/12 h-1 w-3/5 rounded-full" />
					<span className="bg-foreground/12 h-1 w-2/3 rounded-full" />
				</div>
			);
		case "notebook":
			return (
				<div className="flex h-5 items-end gap-0.5">
					{["40%", "75%", "55%", "100%", "65%"].map((height, bar) => (
						<span
							key={bar}
							className={cn(
								"w-1.5 rounded-t-[1px]",
								bar === 3 ? "bg-foreground/35" : "bg-foreground/15",
							)}
							style={{ height }}
						/>
					))}
				</div>
			);
		case "changes":
			return (
				<div className="flex flex-col gap-0.5">
					<span className="bg-foreground/15 h-1 w-4/5 rounded-full" />
					<span className="bg-foreground/15 h-1 w-3/5 rounded-full" />
					<span className="bg-foreground/15 h-1 w-2/3 rounded-full" />
				</div>
			);
		default: {
			const _exhaustive: never = pane;
			return _exhaustive;
		}
	}
}

/** Monthly trend, 0 = top of the chart; the last point carries the accent. */
const TREND = [0.62, 0.55, 0.66, 0.42, 0.48, 0.3, 0.36, 0.18, 0.1] as const;
/** viewBox units; the insets keep the accent point and its halo clear of the cell edge. */
const CHART = { width: 240, height: 80, top: 14, right: 12, bottom: 6, left: 4 } as const;

/**
 * A notebook with history: two receding cells behind the front one, which
 * carries the agent's code, its run status, and the plotted result.
 */
function NotebookArt() {
	return (
		<div className="relative h-28 w-full max-w-[30rem]">
			<span className="bg-foreground/3 absolute inset-x-8 top-1.5 h-24 rounded-2xl" />
			<span className="bg-foreground/5 absolute inset-x-4 top-2.75 h-24 rounded-2xl" />
			<div className="bg-background absolute inset-x-0 top-4 flex h-24 justify-between gap-6 rounded-2xl px-5 py-4 shadow-lg shadow-black/30">
				<div className="flex shrink-0 flex-col justify-between">
					<div className="flex gap-2.5 font-mono text-xs leading-5">
						<span className="text-muted-foreground/60">[4]</span>
						<code className="text-muted-foreground flex flex-col">
							<span>
								df.groupby(<span className="text-foreground">&quot;region&quot;</span>)
							</span>
							<span>&nbsp;&nbsp;.sales.sum().plot()</span>
						</code>
					</div>
					<span className="text-muted-foreground/70 flex items-center gap-1.5 text-[11px]">
						<CheckIcon className="size-3" />
						Ran in 0.4s
					</span>
				</div>
				<TrendChart />
			</div>
		</div>
	);
}

function TrendChart() {
	const reduceMotion = useReducedMotion();
	const fillId = useId();
	const { width, height, top, right, bottom, left } = CHART;
	const points = TREND.map((y, index) => ({
		x: left + (index / (TREND.length - 1)) * (width - left - right),
		y: top + y * (height - top - bottom),
	}));
	const line = points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
	const area = `${line} L ${points.at(-1)!.x} ${height} L ${points[0]!.x} ${height} Z`;
	const end = points.at(-1)!;
	const draw = { duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.5 } as const;

	return (
		<div className="text-foreground relative max-w-60 min-w-0 flex-1">
			<svg
				viewBox={`0 0 ${width} ${height}`}
				preserveAspectRatio="none"
				className="block h-full w-full overflow-visible"
			>
				<defs>
					<linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" stopColor="currentColor" stopOpacity="0.1" />
						<stop offset="1" stopColor="currentColor" stopOpacity="0" />
					</linearGradient>
				</defs>
				<line
					x1={points[0]!.x}
					x2={end.x}
					y1={height - 0.5}
					y2={height - 0.5}
					stroke="currentColor"
					strokeOpacity="0.08"
					vectorEffect="non-scaling-stroke"
				/>
				<motion.path
					d={area}
					fill={`url(#${fillId})`}
					initial={reduceMotion ? false : { opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ ...draw, delay: draw.delay + 0.4 }}
				/>
				<motion.path
					d={line}
					fill="none"
					stroke="currentColor"
					strokeOpacity="0.4"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					initial={reduceMotion ? false : { pathLength: 0 }}
					animate={{ pathLength: 1 }}
					transition={draw}
				/>
			</svg>
			{/* HTML, not SVG: the chart stretches to fit, which would squash a circle. */}
			<motion.span
				className="bg-primary ring-primary/15 absolute size-1.5 -translate-1/2 rounded-full ring-4"
				style={{ left: `${(end.x / width) * 100}%`, top: `${(end.y / height) * 100}%` }}
				initial={reduceMotion ? false : { opacity: 0, scale: 0 }}
				animate={{ opacity: 1, scale: 1 }}
				transition={{ duration: 0.3, delay: draw.delay + draw.duration - 0.2 }}
			/>
		</div>
	);
}
