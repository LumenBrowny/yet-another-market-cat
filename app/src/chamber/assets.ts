/* eslint-disable @typescript-eslint/no-require-imports -- Metro local images. */
// Metro needs literal require calls. Keep textures local and bounded in size.
export const CHAMBER_ART = {
  room: require("../../assets/chamber-v2/room.png"),
  normal: require("../../assets/chamber-v2/normal.png"),
  notice: require("../../assets/chamber-v2/notice.png"),
  panic: require("../../assets/chamber-v2/panic.png"),
  disaster: require("../../assets/chamber-v2/disaster.png"),
} as const;
