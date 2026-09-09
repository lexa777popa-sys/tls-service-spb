// Превращает бинарную маску знака (tools/mask.txt) в гладкий векторный SVG.
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "tools/mask.txt";
const TARGET = "public/images/tls-mark.svg";
const CHAIKIN_PASSES = 2;
const SIMPLIFY_EPSILON = 0.72;
const MIN_LOOP_AREA = 8;

const lines = readFileSync(SOURCE, "utf8").trim().split(/\r?\n/);
const [width, height] = lines[0].split(" ").map(Number);
const rows = lines.slice(1).map((line) => Array.from(line, (ch) => (ch === "1" ? 1 : 0)));

const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : rows[y][x]);

function despeckle() {
  const next = rows.map((row) => row.slice());
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          neighbours += at(x + dx, y + dy);
        }
      }
      if (at(x, y) === 1 && neighbours <= 1) next[y][x] = 0;
      if (at(x, y) === 0 && neighbours >= 7) next[y][x] = 1;
    }
  }
  for (let y = 0; y < height; y += 1) rows[y] = next[y];
}

function borderEdges() {
  const edges = new Map();
  const push = (from, to) => {
    const key = `${from[0]},${from[1]}`;
    const bucket = edges.get(key);
    if (bucket) bucket.push(to);
    else edges.set(key, [to]);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) push([x, y], [x + 1, y]);
      if (!at(x + 1, y)) push([x + 1, y], [x + 1, y + 1]);
      if (!at(x, y + 1)) push([x + 1, y + 1], [x, y + 1]);
      if (!at(x - 1, y)) push([x, y + 1], [x, y]);
    }
  }
  return edges;
}

function traceLoops(edges) {
  const loops = [];
  for (const [startKey, bucket] of edges) {
    while (bucket.length > 0) {
      const start = startKey.split(",").map(Number);
      const loop = [start];
      let current = bucket.shift();
      while (current[0] !== start[0] || current[1] !== start[1]) {
        loop.push(current);
        const nextBucket = edges.get(`${current[0]},${current[1]}`);
        if (!nextBucket || nextBucket.length === 0) break;
        current = nextBucket.shift();
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

function shoelaceArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function perpendicularDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * (px - ax) - dx * (py - ay)) / length;
}

function simplify(points, epsilon) {
  if (points.length < 3) return points;
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (distance > worst) {
      worst = distance;
      index = i;
    }
  }
  if (worst <= epsilon) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, index + 1), epsilon);
  const right = simplify(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

function simplifyLoop(loop, epsilon) {
  const closed = simplify([...loop, loop[0]], epsilon);
  return closed.slice(0, -1);
}

function chaikin(points, passes) {
  let pts = points;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    pts = next;
  }
  return pts;
}

const round = (value) => Number(value.toFixed(2));

function toCubicPath(points) {
  const n = points.length;
  if (n < 3) return "";
  const start = points[0];
  const parts = [`M${round(start[0])} ${round(start[1])}`];
  for (let i = 0; i < n; i += 1) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1x = round(p1[0] + (p2[0] - p0[0]) / 6);
    const c1y = round(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = round(p2[0] - (p3[0] - p1[0]) / 6);
    const c2y = round(p2[1] - (p3[1] - p1[1]) / 6);
    parts.push(`C${c1x} ${c1y} ${c2x} ${c2y} ${round(p2[0])} ${round(p2[1])}`);
  }
  parts.push("Z");
  return parts.join("");
}

despeckle();

const loops = traceLoops(borderEdges())
  .map((loop) => simplifyLoop(chaikin(loop, CHAIKIN_PASSES), SIMPLIFY_EPSILON))
  .filter((loop) => loop.length >= 3 && shoelaceArea(loop) >= MIN_LOOP_AREA)
  .sort((a, b) => shoelaceArea(b) - shoelaceArea(a));

const path = loops.map(toCubicPath).join("");
const pad = 2;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}" fill="#000" fill-rule="evenodd" shape-rendering="geometricPrecision"><path d="${path}"/></svg>\n`;

writeFileSync(TARGET, svg, "utf8");
process.stdout.write(
  `loops: ${loops.length}, points: ${loops.reduce((sum, l) => sum + l.length, 0)}, bytes: ${svg.length}\n`,
);
