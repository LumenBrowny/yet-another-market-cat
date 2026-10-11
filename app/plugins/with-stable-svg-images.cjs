const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");

// RNSVG skips drawing on a bitmap cache miss, including every frame while a
// replacement PNG is decoding. Retain just the last successfully drawn image,
// not an atlas/all poses. Close the reference when replaced or detached.
module.exports = (config) =>
  withDangerousMod(config, [
    "android",
    async (c) => {
      const file = path.resolve(
        c.modRequest.projectRoot,
        "../node_modules/react-native-svg/android/src/main/java/com/horcrux/svg/ImageView.java",
      );
      let source = await fs.readFile(file, "utf8");
      if (source.includes("// YAMC retain last decoded frame")) return c;
      const replace = (before, after) => {
        if (!source.includes(before))
          throw new Error(
            "Review RNSVG image retention patch after dependency update",
          );
        source = source.replace(before, after);
      };
      replace(
        "  private String uriString;",
        `  private String uriString;
  // YAMC retain last decoded frame
  private CloseableReference<CloseableImage> mLastImage;

  private void drawLastImage(Canvas canvas, Paint paint, float opacity) {
    if (CloseableReference.isValid(mLastImage)) {
      CloseableImage image = mLastImage.get();
      if (image instanceof CloseableBitmap) {
        Bitmap bitmap = ((CloseableBitmap) image).getUnderlyingBitmap();
        if (bitmap != null && !bitmap.isRecycled()) doRender(canvas, paint, bitmap, opacity);
      }
    }
  }

  @Override
  protected void onDetachedFromWindow() {
    CloseableReference.closeSafely(mLastImage);
    mLastImage = null;
    super.onDetachedFromWindow();
  }`,
      );
      // Drawing the retained frame and then a transparent replacement would leave
      // ghost outlines. Only use the retained bitmap on the cache-miss path.
      replace(
        "    if (!mLoading.get()) {",
        "    if (mLoading.get()) { drawLastImage(canvas, paint, opacity * mOpacity); return; }\n    if (!mLoading.get()) {",
      );
      replace(
        "        loadBitmap(imagePipeline, request);",
        "        drawLastImage(canvas, paint, opacity * mOpacity);\n        loadBitmap(imagePipeline, request);",
      );
      replace(
        "      if (imageReference == null) {\n        return;",
        "      if (imageReference == null) {\n        drawLastImage(canvas, paint, opacity);\n        return;",
      );
      replace(
        "        doRender(canvas, paint, bitmap, opacity);",
        `        CloseableReference<CloseableImage> next = imageReference.clone();
        CloseableReference.closeSafely(mLastImage);
        mLastImage = next;
        doRender(canvas, paint, bitmap, opacity);`,
      );
      await fs.writeFile(file, source, "utf8");
      return c;
    },
  ]);
