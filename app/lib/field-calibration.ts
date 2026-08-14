import { FIELD_LENGTH_CM, FIELD_WIDTH_CM, type Vec2 } from "./game";

export type ImagePoint = { x: number; y: number };
export type CalibrationDetection = { id: number; center: ImagePoint; corners: ImagePoint[] };
export type Homography = [number, number, number, number, number, number, number, number, number];

export type FieldCalibration = {
  pixelToWorld: Homography;
  worldToPixel: Homography;
  calibratedAt: number;
};

export type FieldPose = { x: number; z: number; headingDeg: number };

export const FIELD_TAG_COORDINATES: Record<number, Vec2> = {
  4: { x: -FIELD_LENGTH_CM / 2, z: -FIELD_WIDTH_CM / 2 },
  5: { x: -FIELD_LENGTH_CM / 2, z: FIELD_WIDTH_CM / 2 },
  6: { x: FIELD_LENGTH_CM / 2, z: FIELD_WIDTH_CM / 2 },
  7: { x: FIELD_LENGTH_CM / 2, z: -FIELD_WIDTH_CM / 2 },
};

function solveLinearSystem(matrix: number[][], values: number[]) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-9) throw new Error("标定点无法形成有效平面");
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }
  return augmented.map((row) => row[size]);
}

export function homographyFromFourPoints(source: ImagePoint[], target: ImagePoint[]): Homography {
  if (source.length !== 4 || target.length !== 4) throw new Error("需要四个标定点");
  const matrix: number[][] = []; const values: number[] = [];
  source.forEach((point, index) => {
    const mapped = target[index];
    matrix.push([point.x, point.y, 1, 0, 0, 0, -mapped.x * point.x, -mapped.x * point.y]); values.push(mapped.x);
    matrix.push([0, 0, 0, point.x, point.y, 1, -mapped.y * point.x, -mapped.y * point.y]); values.push(mapped.y);
  });
  const solved = solveLinearSystem(matrix, values);
  return [...solved, 1] as Homography;
}

export function transformPoint(transform: Homography, point: ImagePoint): ImagePoint {
  const scale = transform[6] * point.x + transform[7] * point.y + transform[8];
  return {
    x: (transform[0] * point.x + transform[1] * point.y + transform[2]) / scale,
    y: (transform[3] * point.x + transform[4] * point.y + transform[5]) / scale,
  };
}

export function calibrateField(detections: CalibrationDetection[]): FieldCalibration {
  const ids = [4, 5, 6, 7];
  const source = ids.map((id) => detections.find((item) => item.id === id)?.center);
  if (source.some((point) => !point)) throw new Error("标定需要同时识别 ID 4、5、6、7");
  const world = ids.map((id) => ({ x: FIELD_TAG_COORDINATES[id].x, y: FIELD_TAG_COORDINATES[id].z }));
  return {
    pixelToWorld: homographyFromFourPoints(source as ImagePoint[], world),
    worldToPixel: homographyFromFourPoints(world, source as ImagePoint[]),
    calibratedAt: Date.now(),
  };
}

// AprilTag corners are returned in a stable tag-relative order. The midpoint of
// corners 0 and 1 is treated as the printed tag's forward edge. Mount that edge
// toward the AURA's physical front so 0° means +X and +90° means +Z.
export function detectionToFieldPose(calibration: FieldCalibration, detection: CalibrationDetection): FieldPose {
  if (detection.corners.length !== 4) throw new Error("机器人 Tag 四角数据不完整");
  const center = transformPoint(calibration.pixelToWorld, detection.center);
  const forwardPixel = {
    x: (detection.corners[0].x + detection.corners[1].x) / 2,
    y: (detection.corners[0].y + detection.corners[1].y) / 2,
  };
  const forward = transformPoint(calibration.pixelToWorld, forwardPixel);
  const rawHeading = Math.atan2(forward.y - center.y, forward.x - center.x) * 180 / Math.PI;
  const headingDeg = ((rawHeading + 180) % 360 + 360) % 360 - 180;
  return { x: center.x, z: center.y, headingDeg };
}
