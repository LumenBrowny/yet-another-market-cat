import React, { memo, useEffect, useRef, useState } from "react";
import { AppState, Image } from "react-native";
import type { ExportedLayer } from "./exported-layout";
import { loopFrame } from "./loops";

// The canonical prepared layers preserve their authored z-order and timing.
export const ExportedChamber = memo(function ExportedChamber({
  layers,
  scale,
  paused,
}: {
  layers: ExportedLayer[];
  scale: number;
  paused: boolean;
}) {
  const [active, setActive] = useState(AppState.currentState === "active");
  const [elapsed, setElapsed] = useState(0);
  const accumulated = useRef(0);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) =>
      setActive(s === "active"),
    );
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (paused || !active) return;
    const animated = layers.filter((l) => l.frames.length > 1);
    if (!animated.length) return;
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = accumulated.current + performance.now() - start;
      setElapsed(t);
      timer = setTimeout(
        tick,
        Math.max(
          16,
          Math.ceil(
            Math.min(
              ...animated.map((l) => loopFrame(t, l.durations).remaining),
            ),
          ),
        ),
      );
    };
    tick();
    return () => {
      clearTimeout(timer);
      accumulated.current += performance.now() - start;
    };
  }, [paused, active, layers]);
  return (
    <>
      {layers.map((l) => (
        <Image
          key={l.id}
          source={l.frames[loopFrame(elapsed, l.durations).index]}
          fadeDuration={0}
          resizeMode="stretch"
          style={{
            position: "absolute",
            left: l.x * scale,
            top: l.y * scale,
            width: l.width * scale,
            height: l.height * scale,
          }}
        />
      ))}
    </>
  );
});
