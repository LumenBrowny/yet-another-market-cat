/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundled assets. */
import React, { memo, useEffect, useRef, useState } from "react";
import { AppState, Image, View } from "react-native";
import { createAudioPlayer } from "expo-audio";
import Svg, { Ellipse } from "react-native-svg";
import { appConfig } from "../config";

// Scene convention: source pixels / 2, then object scale.
const cats = [
  {
    name: "banana",
    x: 205,
    y: 160,
    width: 118,
    height: 250,
    scale: 0.5,
    source: require("../../assets/room-skr-club/cats/banana-cat.png"),
    still: require("../../assets/room-skr-club/cats/banana-cat.png"),
  },
  {
    name: "dancing",
    x: 255,
    y: 190,
    width: 240,
    height: 240,
    scale: 0.5,
    source: require("../../assets/room-skr-club/cats/dancing-cat.webp"),
    still: require("../../assets/room-skr-club/cats/stills/dancing.png"),
  },
  {
    name: "dansi",
    x: 184,
    y: 133,
    width: 128,
    height: 128,
    scale: 0.5,
    source: require("../../assets/room-skr-club/cats/dansi-cat.webp"),
    still: require("../../assets/room-skr-club/cats/stills/dansi.png"),
  },
  {
    name: "headphones",
    x: 51,
    y: 97,
    width: 140,
    height: 160,
    scale: 0.5,
    source: require("../../assets/room-skr-club/cats/headphones-cat.webp"),
    still: require("../../assets/room-skr-club/cats/stills/headphones.png"),
  },
  {
    name: "oiiai",
    x: 90,
    y: 185,
    width: 200,
    height: 200,
    scale: 0.5,
    source: require("../../assets/room-skr-club/cats/oiiai-cat.webp"),
    still: require("../../assets/room-skr-club/cats/stills/oiiai.png"),
  },
  {
    name: "pop",
    x: 156,
    y: 83,
    width: 108,
    height: 112,
    scale: 0.5,
    source: require("../../assets/room-skr-club/cats/pop-cat.webp"),
    still: require("../../assets/room-skr-club/cats/stills/pop.png"),
  },
  {
    name: "vibe",
    x: 0,
    y: 200,
    width: 180,
    height: 180,
    scale: 1,
    source: require("../../assets/room-skr-club/cats/vibe-cat.webp"),
    still: require("../../assets/room-skr-club/cats/stills/vibe.png"),
  },
];

export const SkrClub = memo(function SkrClub({
  width,
  paused,
  soundEnabled,
}: {
  width: number;
  paused: boolean;
  soundEnabled: boolean;
}) {
  const [active, setActive] = useState(AppState.currentState === "active");
  const [flip, setFlip] = useState(1);
  const music = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) =>
      setActive(s === "active"),
    );
    const player = createAudioPlayer(
      require("../../assets/room-skr-club/music.wav"),
    );
    player.loop = true;
    player.volume = 0.4;
    music.current = player;
    // Observe native repeat boundaries; never seek/restart from JS at the seam.
    let previousTime = 0;
    let cycle = 0;
    const diagnostic = appConfig.demoControls
      ? player.addListener("playbackStatusUpdate", (status) => {
          if (
            status.playing &&
            status.duration > 0 &&
            previousTime > status.duration - 2 &&
            status.currentTime < 1
          ) {
            console.info(
              "[YAC club loop]",
              JSON.stringify({
                cycle: ++cycle,
                at: Date.now(),
                duration: status.duration,
                position: status.currentTime,
              }),
            );
          }
          if (status.playing) previousTime = status.currentTime;
        })
      : null;
    return () => {
      sub.remove();
      diagnostic?.remove();
      music.current = null;
      player.pause();
      player.remove();
    };
  }, []);
  useEffect(() => {
    if (active && !paused && soundEnabled) music.current?.play();
    else music.current?.pause();
  }, [active, paused, soundEnabled]);
  useEffect(() => {
    if (!active || paused) return;
    const timer = setInterval(() => setFlip((v) => -v), 476);
    return () => clearInterval(timer);
  }, [active, paused]);
  const running = active && !paused;
  const s = Math.min(width / 340, 1);
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: (width - 340 * s) / 2,
        top: (290 - 290 * s) / 2,
        width: 340 * s,
        height: 290 * s,
      }}
    >
      <Image
        source={require("../../assets/room-skr-club/background-closer.png")}
        resizeMode="stretch"
        fadeDuration={0}
        style={{ width: 340 * s, height: 290 * s }}
      />
      <Svg
        pointerEvents="none"
        width={340 * s}
        height={290 * s}
        viewBox="0 0 340 290"
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        {/* Floor contacts are independent of transparent image canvas bounds. */}
        <Ellipse
          cx={115}
          cy={234}
          rx={15}
          ry={4}
          fill="#080e0b"
          opacity={0.42}
        />
        <Ellipse
          cx={285}
          cy={247}
          rx={20}
          ry={5}
          fill="#080e0b"
          opacity={0.42}
        />
        <Ellipse
          cx={220}
          cy={220}
          rx={13}
          ry={4}
          fill="#080e0b"
          opacity={0.42}
        />
      </Svg>
      {cats.map((cat) => (
        <Image
          key={`${cat.name}-${running}`}
          source={running ? cat.source : cat.still}
          resizeMode="contain"
          fadeDuration={0}
          style={{
            position: "absolute",
            left: cat.x * s,
            top: cat.y * s,
            width: (cat.width / 2) * cat.scale * s,
            height: (cat.height / 2) * cat.scale * s,
            transform: [{ scaleX: cat.name === "banana" ? flip : 1 }],
          }}
        />
      ))}
    </View>
  );
});
