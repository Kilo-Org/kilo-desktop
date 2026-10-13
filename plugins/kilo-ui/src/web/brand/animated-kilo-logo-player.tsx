"use client";

import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import type { FC } from "react";

import { yellowKiloLogoSrc } from "./dotlottie-local.js";

export const AnimatedKiloLogoPlayer: FC = () => (
	<DotLottieReact src={yellowKiloLogoSrc} loop autoplay />
);
