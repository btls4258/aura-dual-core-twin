/*
 * AprilTag detector worker.
 * WASM detector: https://github.com/arenaxr/apriltag-js-standalone
 * License: BSD-3-Clause, see THIRD_PARTY_NOTICES.md.
 */
importScripts("/apriltag_wasm.js");

let moduleRef;
let setImageBuffer;
let detectTags;

function decodeDetections(pointer) {
  const length = moduleRef.getValue(pointer, "i32");
  if (!length) return [];
  const stringPointer = moduleRef.getValue(pointer + 4, "i32");
  const bytes = new Uint8Array(moduleRef.HEAP8.buffer, stringPointer, length);
  return JSON.parse(new TextDecoder().decode(bytes));
}

AprilTagWasm().then((module) => {
  moduleRef = module;
  const initialize = module.cwrap("atagjs_init", "number", []);
  const setOptions = module.cwrap("atagjs_set_detector_options", "number", ["number", "number", "number", "number", "number", "number", "number"]);
  setImageBuffer = module.cwrap("atagjs_set_img_buffer", "number", ["number", "number", "number"]);
  detectTags = module.cwrap("atagjs_detect", "number", []);
  initialize();
  setOptions(2, 0, 1, 1, 24, 0, 0);
  self.postMessage({ type: "ready" });
}).catch((error) => self.postMessage({ type: "error", message: error?.message ?? String(error) }));

self.onmessage = (event) => {
  if (event.data?.type !== "detect" || !moduleRef) return;
  const startedAt = performance.now();
  try {
    const pixels = new Uint8Array(event.data.pixels);
    const imagePointer = setImageBuffer(event.data.width, event.data.height, event.data.width);
    moduleRef.HEAPU8.set(pixels, imagePointer);
    const detections = decodeDetections(detectTags());
    self.postMessage({
      type: "detections",
      width: event.data.width,
      height: event.data.height,
      capturedAt: event.data.capturedAt,
      processingMs: performance.now() - startedAt,
      detections,
    });
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message ?? String(error) });
  }
};
