import { FIELD_LENGTH_CM, FIELD_SAFE_MARGIN_CM, FIELD_WIDTH_CM, type Vec2 } from "./game";

export type NavigationObstacle = { id: string; x: number; z: number; radius: number };
export type PlannedRoute = { points: Vec2[]; length: number; direct: boolean };

export const ROBOT_RADIUS_CM = 7.5;
export const POSITIONING_MARGIN_CM = 2.5;
export const ROBOT_CLEARANCE_CM = ROBOT_RADIUS_CM + POSITIONING_MARGIN_CM;
export const ROBOT_COLLISION_RADIUS_CM = ROBOT_RADIUS_CM * 2 + POSITIONING_MARGIN_CM;

export const STATIC_NAVIGATION_OBSTACLES: NavigationObstacle[] = [
  { id: "base-red", x: -79, z: 0, radius: 7.5 + ROBOT_CLEARANCE_CM },
  { id: "base-blue", x: 79, z: 0, radius: 7.5 + ROBOT_CLEARANCE_CM },
  { id: "central-core", x: 0, z: 0, radius: 5 + ROBOT_CLEARANCE_CM },
  { id: "ruin-north-west", x: -20, z: -27, radius: 5 + ROBOT_CLEARANCE_CM },
  { id: "cliff-north-east", x: 20, z: -27, radius: 5 + ROBOT_CLEARANCE_CM },
  { id: "cliff-south-west", x: -20, z: 27, radius: 5 + ROBOT_CLEARANCE_CM },
  { id: "ruin-south-east", x: 20, z: 27, radius: 5 + ROBOT_CLEARANCE_CM },
];

// Obstacle radii already include the robot radius and a 2.5 cm positioning margin.
// Keep this extra planner padding small, otherwise the core and side-cover safety
// circles overlap and falsely seal the entire midfield corridor.
const GRID_STEP_CM = 2;
const PLANNING_MARGIN_CM = .5;
const maxX = FIELD_LENGTH_CM / 2 - FIELD_SAFE_MARGIN_CM;
const maxZ = FIELD_WIDTH_CM / 2 - FIELD_SAFE_MARGIN_CM;

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

const pointSafe = (point: Vec2, obstacles: NavigationObstacle[], padding = 0) => {
  if (Math.abs(point.x) > maxX || Math.abs(point.z) > maxZ) return false;
  return obstacles.every((obstacle) => Math.hypot(point.x - obstacle.x, point.z - obstacle.z) >= obstacle.radius + padding - .01);
};

const segmentSafe = (from: Vec2, to: Vec2, obstacles: NavigationObstacle[], padding = 0) => {
  if (!pointSafe(from, obstacles, padding) || !pointSafe(to, obstacles, padding)) return false;
  const dx = to.x - from.x; const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  return obstacles.every((obstacle) => {
    const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((obstacle.x - from.x) * dx + (obstacle.z - from.z) * dz) / lengthSquared));
    const closestX = from.x + dx * projection; const closestZ = from.z + dz * projection;
    return Math.hypot(closestX - obstacle.x, closestZ - obstacle.z) >= obstacle.radius + padding - .01;
  });
};

const routeLength = (points: Vec2[]) => points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);

const simplifyRoute = (points: Vec2[], obstacles: NavigationObstacle[]) => {
  const simplified: Vec2[] = [points[0]];
  let current = 0;
  while (current < points.length - 1) {
    let next = points.length - 1;
    while (next > current + 1 && !segmentSafe(points[current], points[next], obstacles, PLANNING_MARGIN_CM)) next -= 1;
    simplified.push(points[next]);
    current = next;
  }
  return simplified;
};

const roundedRoute = (points: Vec2[]) => {
  if (points.length < 3) return points;
  const rounded: Vec2[] = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]; const corner = points[index]; const next = points[index + 1];
    const previousLength = distance(previous, corner); const nextLength = distance(corner, next);
    const radius = Math.min(6, previousLength * .28, nextLength * .28);
    const entry = { x: corner.x + (previous.x - corner.x) / previousLength * radius, z: corner.z + (previous.z - corner.z) / previousLength * radius };
    const exit = { x: corner.x + (next.x - corner.x) / nextLength * radius, z: corner.z + (next.z - corner.z) / nextLength * radius };
    rounded.push(entry);
    for (let step = 1; step <= 6; step += 1) {
      const t = step / 6; const inverse = 1 - t;
      rounded.push({
        x: inverse * inverse * entry.x + 2 * inverse * t * corner.x + t * t * exit.x,
        z: inverse * inverse * entry.z + 2 * inverse * t * corner.z + t * t * exit.z,
      });
    }
  }
  rounded.push(points.at(-1)!);
  return rounded;
};

export function planRoute(start: Vec2, goal: Vec2, dynamicObstacles: NavigationObstacle[] = []): PlannedRoute | null {
  const obstacles = [...STATIC_NAVIGATION_OBSTACLES, ...dynamicObstacles];
  if (!pointSafe(start, obstacles) || !pointSafe(goal, obstacles)) return null;
  if (segmentSafe(start, goal, obstacles, PLANNING_MARGIN_CM)) return { points: [start, goal], length: distance(start, goal), direct: true };

  const columns = Math.round(maxX * 2 / GRID_STEP_CM) + 1;
  const rows = Math.round(maxZ * 2 / GRID_STEP_CM) + 1;
  const coordinate = (index: number): Vec2 => ({ x: -maxX + index % columns * GRID_STEP_CM, z: -maxZ + Math.floor(index / columns) * GRID_STEP_CM });
  const indexFor = (point: Vec2) => {
    const column = Math.max(0, Math.min(columns - 1, Math.round((point.x + maxX) / GRID_STEP_CM)));
    const row = Math.max(0, Math.min(rows - 1, Math.round((point.z + maxZ) / GRID_STEP_CM)));
    return row * columns + column;
  };
  const nearestSafeIndex = (point: Vec2) => {
    const origin = indexFor(point); const originColumn = origin % columns; const originRow = Math.floor(origin / columns);
    for (let radius = 0; radius <= 4; radius += 1) {
      for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
        for (let columnOffset = -radius; columnOffset <= radius; columnOffset += 1) {
          const column = originColumn + columnOffset; const row = originRow + rowOffset;
          if (column < 0 || column >= columns || row < 0 || row >= rows) continue;
          const candidate = row * columns + column; const candidatePoint = coordinate(candidate);
          if (pointSafe(candidatePoint, obstacles, PLANNING_MARGIN_CM) && segmentSafe(point, candidatePoint, obstacles)) return candidate;
        }
      }
    }
    return -1;
  };

  const startIndex = nearestSafeIndex(start); const goalIndex = nearestSafeIndex(goal);
  if (startIndex < 0 || goalIndex < 0) return null;
  const open = new Set<number>([startIndex]);
  const cameFrom = new Map<number, number>();
  const score = new Map<number, number>([[startIndex, 0]]);
  const estimate = new Map<number, number>([[startIndex, distance(coordinate(startIndex), goal)]]);
  const offsets = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

  while (open.size) {
    let current = -1; let best = Infinity;
    for (const candidate of open) {
      const value = estimate.get(candidate) ?? Infinity;
      if (value < best) { best = value; current = candidate; }
    }
    if (current === goalIndex) {
      const indices = [current];
      while (cameFrom.has(current)) { current = cameFrom.get(current)!; indices.push(current); }
      indices.reverse();
      const raw = [start, ...indices.map(coordinate), goal].filter((point, index, array) => index === 0 || distance(point, array[index - 1]) > .05);
      const simplified = simplifyRoute(raw, obstacles);
      const curved = roundedRoute(simplified);
      const curveIsSafe = curved.every((point, index) => pointSafe(point, obstacles, .15) && (index === 0 || segmentSafe(curved[index - 1], point, obstacles, .15)));
      const points = curveIsSafe ? curved : simplified;
      return { points, length: routeLength(points), direct: false };
    }
    open.delete(current);
    const currentPoint = coordinate(current); const column = current % columns; const row = Math.floor(current / columns);
    for (const [columnOffset, rowOffset] of offsets) {
      const nextColumn = column + columnOffset; const nextRow = row + rowOffset;
      if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
      const neighbor = nextRow * columns + nextColumn; const neighborPoint = coordinate(neighbor);
      if (!segmentSafe(currentPoint, neighborPoint, obstacles, PLANNING_MARGIN_CM)) continue;
      const tentative = (score.get(current) ?? Infinity) + distance(currentPoint, neighborPoint);
      if (tentative >= (score.get(neighbor) ?? Infinity)) continue;
      cameFrom.set(neighbor, current); score.set(neighbor, tentative);
      estimate.set(neighbor, tentative + distance(neighborPoint, goal)); open.add(neighbor);
    }
  }
  return null;
}
