import React, { Profiler, useEffect, useRef, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, {
  Ellipse,
  G,
  Path,
  Rect,
  Text as SvgText,
  Image as SvgImage,
} from "react-native-svg";
import * as Haptics from "expo-haptics";
import {
  CatEngine,
  project,
  type CatRenderState,
  spriteScale,
  anchorWorld,
  YAMC_VIEW,
  type CatState,
} from "@yac/cat-shit-engine";

import { particleLayers } from "@yac/cat-shit-engine/src/particleLayers";
import { floorShadow } from "@yac/cat-shit-engine/src/shadow";
import { roomForTier } from "@yac/cat-shit-engine/src/chamber";
import { ChamberEnvironment, ChamberFrame } from "./chamber/ChamberEnvironment";
import { CHAMBER_LAYOUT } from "./chamber/layout";
import { CatArtwork } from "./CatArtwork";
import { YamcAudioPlayer } from "./yamcAudio";
import { MeowMouth } from "@yac/cat-shit-engine/src/mouth";
import { renderSpriteMetadata } from "@yac/cat-shit-engine/src/yamc";
import { YAMC_VARIANTS } from "./yamcVariants";
import { MINING_TIERS } from "@yac/shared";

import { appConfig } from "./config";
import { useSkrRoom } from "./skr/useSkrRoom";
import { SkrClub } from "./skr/SkrClub";
import { SkrDetector } from "./skr/SkrDetector";
const demoEnabled = __DEV__ || appConfig.demoControls;
const W = YAMC_VIEW.width,
  H = YAMC_VIEW.height;
const pixel = (v: number) => v.toFixed(1);
function particlePath(particles: CatRenderState["particles"], stream: boolean) {
  let path = "";
  for (const p of particles) {
    if (p.stream !== stream) continue;
    const at = project(p.position),
      x = at.x * W,
      y = at.y * H,
      r = p.size * W * at.scale * (1 - p.age / p.lifetime);
    if (stream) {
      const dx = p.velocity.x * r * 2,
        dy = p.velocity.y * r * 2;
      path += `M${pixel(x - r)},${pixel(y)}Q${pixel(x + dx)},${pixel(y + dy - r)} ${pixel(x + r)},${pixel(y)}Q${pixel(x - dx)},${pixel(y - dy + r)} ${pixel(x - r)},${pixel(y)}Z`;
    } else
      path += `M${pixel(x - r)},${pixel(y + r)}Q${pixel(x - r * 1.5)},${pixel(y)} ${pixel(x - r * 0.4)},${pixel(y - r * 0.3)}Q${pixel(x - r * 0.7)},${pixel(y - r)} ${pixel(x)},${pixel(y - r * 1.4)}Q${pixel(x + r * 0.8)},${pixel(y - r)} ${pixel(x + r * 0.5)},${pixel(y)}Q${pixel(x + r * 1.5)},${pixel(y + r)} ${pixel(x - r)},${pixel(y + r)}Z`;
  }
  return path;
}
function ParticleLayer({
  particles,
  coin,
}: {
  particles: CatRenderState["particles"];
  coin: "64" | "128" | "svg";
}) {
  return (
    <>
      {coin === "svg" ? (
        <Path d={particlePath(particles, false)} fill="#b18a54" />
      ) : (
        particles
          .filter((p) => !p.stream)
          .map((p) => {
            const pos = project(p.position),
              r = p.size * W * pos.scale * (1 - p.age / p.lifetime);
            return (
              <SvgImage
                key={p.id}
                href={YAMC_VARIANTS[`catshitcoin-${coin}`]}
                x={pos.x * W - r}
                y={pos.y * H - r}
                width={r * 2}
                height={r * 2}
              />
            );
          })
      )}
      <Path d={particlePath(particles, true)} fill="#b39948" opacity={0.7} />
    </>
  );
}
const SPLAT_ART = (
  <Path
    d="M-8 -8L-22 -16L-15 -2L-27 9L-10 8L-9 24L2 13L16 22L11 6L27 -1L12 -6L16 -24L3 -13L-8 -25ZM-30 -21a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M19 17a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"
    fill="#8c733d"
  />
);
export function CatScene({
  state,
  wallet = null,
  walletRevision = 0,
}: {
  state: CatState;
  wallet?: string | null;
  walletRevision?: number;
}) {
  const skr = useSkrRoom(wallet, walletRevision);
  const [engine] = useState(() => new CatEngine({ seed: 12345 }));
  const renderCost = useRef({ total: 0, count: 0 });
  const [override, setOverride] = useState<CatState | null>(null);
  const [debug, setDebug] = useState(false);
  const [paused, setPaused] = useState(false);
  const legacyRoom = false;
  const [haptics, setHaptics] = useState(true);
  const [muted, setMuted] = useState(true);
  const anchors = false;
  const roomArt = true;
  const [sceneWidth, setSceneWidth] = useState<number>(W);
  const shadowOffset = 0;
  const audio = useRef<YamcAudioPlayer | null>(null);
  const [mouth] = useState(() => new MeowMouth());
  const purrSide: "left" | "right" = "right";
  const coin: "128" | "64" | "svg" = "64";
  useEffect(() => {
    const player = new YamcAudioPlayer(() =>
      mouth.start(performance.now() / 1000),
    );
    audio.current = player;
    return () => {
      player.dispose();
      audio.current = null;
    };
  }, [mouth]);
  useEffect(() => {
    if (muted || paused) {
      audio.current?.stop();
      mouth.reset();
    }
  }, [muted, paused, mouth]);
  const [frame, setFrame] = useState(() => engine.snapshot());
  const flags = useRef({ haptics, debug, paused, muted, roomArt, legacyRoom });
  flags.current = { haptics, debug, paused, muted, roomArt, legacyRoom };
  const visualState = demoEnabled && override ? override : state;
  const tier = MINING_TIERS.find((t) => t.id === visualState)!;
  const chainTier = MINING_TIERS.find((t) => t.id === state)!;
  useEffect(() => {
    engine.setState(visualState);
    mouth.reset();
    setFrame(engine.snapshot());
  }, [engine, visualState, mouth]);
  useEffect(() => {
    let request = 0,
      last: number | undefined,
      active = AppState.currentState === "active",
      lastHaptic = -10000;
    let samples: number[] = [],
      costs: number[] = [],
      since: number | undefined;
    const loop = (time: number) => {
      if (!active) return;
      const delta = last === undefined ? 0 : (time - last) / 1000;
      since ??= time;
      last = time;
      const start = performance.now();
      if (!flags.current.paused) {
        const next = engine.advance(delta);
        setFrame(next);
        const events = engine.drainEvents();
        audio.current?.configure(visualState, !flags.current.muted);
        if (
          events.some(
            (e) => e.type === "FRONT_IMPACT" && e.impactStrength >= 0.3,
          )
        )
          audio.current?.bonk();
        for (const e of events) {
          const strong =
            e.type === "SHIT_PRESSURE_CRITICAL" || e.type === "CAT_ORBIT";
          const impact = e.type === "FRONT_IMPACT" && e.impactStrength >= 0.3;
          if (
            flags.current.haptics &&
            (strong || impact) &&
            time - lastHaptic > 650
          ) {
            lastHaptic = time;
            const task =
              Platform.OS === "android"
                ? Haptics.performAndroidHapticsAsync(
                    strong
                      ? Haptics.AndroidHaptics.Reject
                      : Haptics.AndroidHaptics.Confirm,
                  )
                : Haptics.impactAsync(
                    strong
                      ? Haptics.ImpactFeedbackStyle.Heavy
                      : Haptics.ImpactFeedbackStyle.Medium,
                  );
            void task
              .then(() => {
                if (demoEnabled && flags.current.debug)
                  console.info("[YAC haptic]", e.type, "ok");
              })
              .catch(() => {});
          }
        }
      } else engine.pause();
      if (demoEnabled && delta > 0) {
        samples.push(delta * 1000);
        costs.push(performance.now() - start);
        if (time - since >= 10000) {
          const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
          const sorted = [...samples].sort((a, b) => a - b);
          const render = renderCost.current;
          const line = `${visualState} RAF ${(1000 / mean).toFixed(1)} fps · p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)}ms · engine ${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(2)}ms · SVG React ${(render.total / Math.max(1, render.count)).toFixed(2)}ms`;
          renderCost.current = { total: 0, count: 0 };
          console.info(
            "[YAC perf]",
            `${line} · room ${flags.current.roomArt ? (flags.current.legacyRoom ? "v2 baseline" : "v2.1 loops") : "wireframe"}`,
          );
          samples = [];
          costs = [];
          since = time;
        }
      }
      request = requestAnimationFrame(loop);
    };
    request = requestAnimationFrame(loop);
    const sub = AppState.addEventListener("change", (next) => {
      cancelAnimationFrame(request);
      active = next === "active";
      last = undefined;
      engine.pause();
      audio.current?.stop();
      mouth.reset();
      samples = [];
      costs = [];
      since = undefined;
      if (active) request = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(request);
      audio.current?.stop();
      sub.remove();
    };
  }, [engine, visualState, mouth]);
  const b = frame.body,
    at = project(b.position);
  const dead = visualState === "DEAD_INSIDE",
    impact = !!frame.impactState;
  const sprite = renderSpriteMetadata(
    frame.presentation.spriteId,
    visualState,
    purrSide,
  );
  const layers = particleLayers(frame.particles, b.position.z);
  const scale = spriteScale(b, sprite);
  const rear = project(anchorWorld(b, sprite, sprite.rearAnchor));
  const shadow = floorShadow(b, sprite);
  // The idle body does not simulate motion: seat its visible loaf silhouette on
  // the floor. Other tiers keep the engine projection and emission untouched.
  const restingOffsetY =
    dead && !impact
      ? shadow.y -
        (at.y * H +
          (CHAMBER_LAYOUT.loafBottom[purrSide] - sprite.centerAnchor.y) *
            128 *
            scale *
            b.squashY)
      : 0;
  const control = (label: string, action: () => void) => (
    <Pressable
      accessibilityRole="button"
      onPress={action}
      style={styles.button}
    >
      <Text style={styles.control}>{label}</Text>
    </Pressable>
  );
  return (
    <View>
      {demoEnabled && override && (
        <Text style={styles.debugLabel}>VISUAL PREVIEW · stake unchanged</Text>
      )}
      {demoEnabled && paused && (
        <Text style={styles.debugLabel}>
          DEBUG PAUSED · frozen simulation frame
        </Text>
      )}
      <View
        style={styles.chamber}
        onLayout={(event) => setSceneWidth(event.nativeEvent.layout.width)}
        accessibilityLabel={`${visualState}. ${roomForTier(visualState).description} ${frame.message}`}
      >
        {skr.club ? (
          <SkrClub width={sceneWidth} paused={paused} soundEnabled={!muted} />
        ) : (
          (!demoEnabled || roomArt) && (
            <ChamberEnvironment
              tier={visualState}
              viewportWidth={sceneWidth}
              cameraX={frame.camera.x}
              cameraY={frame.camera.y}
              paused={paused}
              legacy={demoEnabled && legacyRoom}
            />
          )
        )}
        <SkrDetector
          layer="art"
          width={sceneWidth}
          status={skr.status}
          club={skr.club}
          arming={skr.arming}
          onPress={skr.tap}
          onRefresh={skr.refresh}
          paused={paused}
        />
        <Profiler
          id="chamber"
          onRender={(_id, _phase, duration) => {
            if (demoEnabled) {
              renderCost.current.total += duration;
              renderCost.current.count++;
            }
          }}
        >
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
            {demoEnabled && !roomArt && (
              <G>
                <Rect width={W} height={H} rx={15} fill="#151e1a" />
                <G stroke="#344336" fill="none" strokeWidth={1}>
                  <Rect x={65} y={55} width={210} height={180} />
                  <Path d="M0 0L65 55M340 0L275 55M0 290L65 235M340 290L275 235M65 115H275M65 175H275M135 55V235M205 55V235" />
                </G>
                <SvgText x={14} y={22} fontSize={9} fill="#788e78">
                  CONTAINMENT CHAMBER / 002
                </SvgText>
              </G>
            )}
            <G
              transform={`translate(${frame.camera.x * W} ${frame.camera.y * H})`}
            >
              <Ellipse
                cx={shadow.x}
                cy={shadow.y + (demoEnabled ? shadowOffset : 0)}
                rx={shadow.rx}
                ry={shadow.ry}
                fill="#080e0b"
                opacity={shadow.opacity}
              />
              <ParticleLayer particles={layers.behind} coin={coin} />
              <G
                transform={`translate(${at.x * W} ${at.y * H + restingOffsetY}) rotate(${((b.rotation + sprite.rotationBias) * 180) / Math.PI}) scale(${scale * b.squashX} ${scale * b.squashY}) translate(${-sprite.centerAnchor.x * 128} ${-sprite.centerAnchor.y * 128})`}
              >
                <CatArtwork
                  presentation={frame.presentation}
                  tier={visualState}
                  mouthOpen={
                    !muted && !paused && mouth.open(performance.now() / 1000)
                  }
                  purrSide={purrSide}
                />
              </G>
              <ParticleLayer particles={layers.front} coin={coin} />
            </G>
            {demoEnabled && anchors && (
              <G
                transform={`translate(${frame.camera.x * W} ${frame.camera.y * H})`}
              >
                <Ellipse
                  cx={rear.x * W}
                  cy={rear.y * H + restingOffsetY}
                  rx={4}
                  ry={4}
                  fill="#ff855c"
                />
                <Ellipse
                  cx={at.x * W}
                  cy={at.y * H + restingOffsetY}
                  rx={3}
                  ry={3}
                  fill="#98e2fa"
                />
              </G>
            )}
            {/* Glass decals intentionally sit outside world/camera transforms. */}
            {frame.splats.map((s) => (
              <G<unknown>
                key={s.id}
                opacity={s.opacity}
                transform={`translate(${s.normalizedX * W} ${(s.normalizedY + s.dripOffset) * H}) rotate(${s.rotation}) scale(${s.scale})`}
              >
                {SPLAT_ART}
              </G>
            ))}
            {impact && (
              <SvgText
                x={W / 2}
                y={52}
                textAnchor="middle"
                fill="#eff8a8"
                stroke="#151e1a"
                strokeWidth={0.4}
                fontSize={30}
                fontWeight="900"
              >
                BONK!
              </SvgText>
            )}
            {!skr.club && (!demoEnabled || roomArt) && (
              <ChamberFrame tier={visualState} />
            )}
            {demoEnabled && anchors && (
              <SvgText
                x={W - 12}
                y={H - 12}
                textAnchor="end"
                fontSize={9}
                fill="#78917b"
              >
                {frame.presentation.spriteId.toUpperCase()}
              </SvgText>
            )}
          </Svg>
        </Profiler>
        <SkrDetector
          width={sceneWidth}
          status={skr.status}
          club={skr.club}
          arming={skr.arming}
          onPress={skr.tap}
          onRefresh={skr.refresh}
          paused={paused}
        />
      </View>
      <View style={styles.row}>
        <Text style={styles.tier}>
          {override ? "PREVIEW " : ""}
          {tier.displayMultiplier} {tier.id.replaceAll("_", " ")}
        </Text>
        <Text style={styles.rate}>
          {chainTier.displayMultiplier.slice(1)} PP/sec
          {override ? " (chain)" : ""}
        </Text>
      </View>
      <Text style={styles.note}>
        Animation follows stake · points accrue offline
      </Text>
      <Text style={styles.message}>
        {frame.message ||
          (dead
            ? "Lock 1,000 CATSHIT to start the cat."
            : "Honest work. Questionable output.")}
      </Text>
      <View style={styles.row}>
        {control(`HAPTICS ${haptics ? "ON" : "OFF"}`, () =>
          setHaptics(!haptics),
        )}
        {control(`SOUND ${muted ? "OFF" : "ON"}`, () => {
          if (!muted) audio.current?.stop();
          setMuted(!muted);
        })}
        {demoEnabled &&
          control(debug ? "CLOSE DEMO" : "DEMO / PHYSICS", () => {
            if (debug) setOverride(null);
            setDebug(!debug);
          })}
      </View>
      {demoEnabled && debug && (
        <View style={styles.debug}>
          <Text style={styles.debugLabel}>
            VISUAL DEMO ONLY · actual chain tier: {state}
          </Text>
          <Text style={styles.debugLabel}>
            ROOM: {roomForTier(visualState).id}
          </Text>
          <View style={styles.row}>
            {(
              [
                ["ROOM IDLE", "DEAD_INSIDE"],
                ["ROOM NOTICE", "CONCERNED"],
                ["ROOM PANIC", "AIRBORNE"],
                ["ROOM DISASTER", "TRANSCENDENT"],
              ] as const
            ).map(([label, id]) => (
              <React.Fragment key={id}>
                {control(label, () => {
                  setPaused(false);
                  setOverride(id);
                })}
              </React.Fragment>
            ))}
          </View>
          <Text style={styles.note}>
            Preview only · stake and rewards unchanged. Close demo to return to
            your real tier.
          </Text>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  chamber: { overflow: "hidden", borderRadius: 15 },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    marginTop: 8,
  },
  tier: { color: "#eef3df", fontWeight: "800", fontSize: 18 },
  rate: { color: "#c6f078", fontWeight: "800", fontSize: 17 },
  note: { color: "#99a58b", fontSize: 11, marginTop: 6 },
  message: { color: "#d9dfca", fontSize: 12, minHeight: 32, marginTop: 6 },
  button: { backgroundColor: "#303e29", borderRadius: 6, padding: 9 },
  control: { color: "#dce8c6", fontSize: 9, fontWeight: "700" },
  debug: {
    marginTop: 10,
    padding: 8,
    backgroundColor: "#111b16",
    borderRadius: 8,
  },
  debugLabel: { color: "#f4c47a", fontSize: 10, marginBottom: 6 },
});
