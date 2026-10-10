import React, { memo } from "react";
import { Circle, Ellipse, G, Path, Image as SvgImage } from "react-native-svg";
import type { YamcPresentation } from "@yac/cat-shit-engine";
import { YAMC_IMAGES } from "./yamcAssets";
import { YAMC_VARIANTS } from "./yamcVariants";
import { artworkKey } from "@yac/cat-shit-engine/src/mouth";
import type { CatState } from "@yac/shared";

/** Provisional vector pack in a 128-square canvas. Artist PNGs replace it per ID. */
export const CatArtwork = memo(function CatArtwork({
  presentation,
  tier,
  mouthOpen = false,
  purrSide = "right",
}: {
  presentation: YamcPresentation;
  tier: CatState;
  mouthOpen?: boolean;
  purrSide?: "left" | "right";
}) {
  const { spriteId, direction, expression } = presentation;
  const source =
    YAMC_VARIANTS[artworkKey(spriteId, tier, mouthOpen, purrSide)] ??
    YAMC_IMAGES[spriteId];
  if (source)
    return (
      <SvgImage
        href={source}
        x={0}
        y={0}
        width={128}
        height={128}
        preserveAspectRatio="none"
      />
    );
  const special = ![
    "front",
    "front-left",
    "left",
    "back-left",
    "back",
    "back-right",
    "right",
    "front-right",
  ].includes(spriteId);
  const facing = special ? "front" : direction;
  const back = facing.startsWith("back");
  const side = facing === "left" || facing === "right";
  const flip = facing.includes("left");
  const headX = side ? 84 : facing.includes("right") || flip ? 75 : 64;
  const bonk = spriteId === "bonk-impact";
  const panic = expression === "panic";
  return (
    <G transform={spriteId === "falling" ? "rotate(180 64 64)" : undefined}>
      <G transform={flip ? "translate(128 0) scale(-1 1)" : undefined}>
        <Path
          d={side ? "M34 74Q9 86 17 53" : "M43 81Q13 89 24 65"}
          fill="none"
          stroke="#171c20"
          strokeWidth={11}
          strokeLinecap="round"
        />
        <Ellipse
          cx={side ? 57 : 64}
          cy={75}
          rx={side ? 35 : 27}
          ry={24}
          fill="#20262c"
          stroke="#85928a"
          strokeWidth={1.5}
        />
        <Ellipse cx={side ? 67 : 64} cy={80} rx={18} ry={18} fill="#eee9da" />
        <Path
          d="M43 86L39 103Q43 108 52 103L55 88M75 88L77 105Q89 109 91 102L87 84"
          fill="#f4efdd"
          stroke="#22272c"
          strokeWidth={2}
        />
        {spriteId === "upward-thrust" && (
          <Path
            d="M42 72L19 49M87 72L109 49"
            stroke="#eee9da"
            strokeWidth={10}
            strokeLinecap="round"
          />
        )}
        <G transform={`translate(${headX - 64} 0)`}>
          <Path
            d="M34 47L29 12L51 27Q64 20 78 27L100 13L94 53Q92 74 64 76Q36 74 34 47"
            fill="#1b2228"
            stroke="#83938d"
            strokeWidth={1.5}
          />
          <Path d="M34 21L39 38L48 30M94 22L80 31L90 39" fill="#a57c7a" />
          {back ? (
            <G>
              <Path d="M53 28Q65 35 77 27L74 69Q65 76 56 69Z" fill="#ede9dd" />
              <Path
                d="M40 53Q65 67 89 51"
                fill="none"
                stroke="#323c44"
                strokeWidth={3}
              />
            </G>
          ) : (
            <G>
              <Path
                d="M63 30L52 54Q32 55 39 67Q65 82 89 66Q94 55 76 53Z"
                fill="#f5f0df"
              />
              <Ellipse
                cx={50}
                cy={46}
                rx={bonk ? 14 : 13}
                ry={bonk ? 7 : 15}
                fill="#fffbed"
                stroke="#080c11"
                strokeWidth={2}
              />
              <Ellipse
                cx={78}
                cy={45}
                rx={13}
                ry={bonk ? 7 : 16}
                fill="#fffbed"
                stroke="#080c11"
                strokeWidth={2}
              />
              {bonk ? (
                <Path
                  d="M44 42L55 50M55 42L44 50M72 42L83 50M83 42L72 50"
                  stroke="#161c22"
                  strokeWidth={2.5}
                />
              ) : (
                <G>
                  <Circle cx={52} cy={46} r={panic ? 3 : 4.2} fill="#111820" />
                  <Circle
                    cx={76}
                    cy={44}
                    r={panic ? 2.8 : 3.8}
                    fill="#111820"
                  />
                  <Circle cx={53} cy={45} r={1} fill="#fff" />
                  <Circle cx={77} cy={43} r={1} fill="#fff" />
                </G>
              )}
              <Path d="M57 58L70 57L64 63Z" fill="#9b7775" />
              <Path
                d="M47 63L51 58L57 65L53 73L45 70ZM72 62L83 59L87 66L77 70Z"
                fill="#9b7954"
                opacity={0.8}
              />
              {panic || bonk ? (
                <Ellipse
                  cx={65}
                  cy={69}
                  rx={6}
                  ry={panic ? 9 : 4}
                  fill="#2a171d"
                />
              ) : (
                <Path
                  d="M64 63L63 69L58 71M63 69L68 72"
                  fill="none"
                  stroke="#463738"
                  strokeWidth={2}
                />
              )}
              <Path
                d="M43 60L22 55M43 66L22 69M86 59L107 54M86 65L106 70"
                stroke="#afbab1"
                strokeWidth={1.3}
              />
              <Path
                d="M37 30L48 26M78 25L91 28"
                stroke="#eceddb"
                strokeWidth={2}
              />
            </G>
          )}
        </G>
        {spriteId === "transcendent-panic" && (
          <G fill="none" stroke="#eff7a2" strokeWidth={1.5}>
            <Ellipse cx={64} cy={10} rx={22} ry={5} />
            <Path d="M13 34L7 24M113 42L122 31M9 70L3 65" />
          </G>
        )}
      </G>
    </G>
  );
});
