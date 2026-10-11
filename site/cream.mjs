export const CREAM_FRAME_INTERVAL = 1000 / 30;
export const CREAM_PIXEL_BUDGET = 2_000_000;
export const CREAM_MOTION_MULTIPLIER = 2;
export const CREAM_GEOMETRY_MULTIPLIER = 2;
export const GROUP_GEOMETRY_MULTIPLIER = CREAM_GEOMETRY_MULTIPLIER / 1.5;
export const LARGE_GROUP_GEOMETRY_MULTIPLIER = GROUP_GEOMETRY_MULTIPLIER / 2;
export const GROUP_MOTION_PROFILE = Object.freeze({ cycles: 8, gapFraction: .042, maxGapFraction: .044 });
export const CREAM_MAX_GROUPS = 9;
export const CREAM_MAX_DROPLETS = 8;
export const CREAM_MAX_SPAWNS = 8;
export const CREAM_MAX_PRIMITIVES = 48;
export const CREAM_TRAIL_LENGTH = .99;
export const CREAM_SPAWN_BASE_RADIUS = .075;
export const SPAWN_GEOMETRY_MULTIPLIER = 1;
export const SPAWN_SHAPE_PROFILE = Object.freeze({ extent: .94, minAspect: .70, maxAspect: .84 });
export const CREAM_EDGE_PROFILE = Object.freeze({
  largeFraction: .14, glassMaxWidth: 1344, glassGutter: 32,
  wideFrom: 1200, wideIntrusion: 32, narrowIntrusion: 16,
});
export const CURSOR_SHAPE_PROFILE = Object.freeze({ minStretch: 1.08, maxStretch: 1.38, maxExtent: 1.51 });

const TAU = Math.PI * 2;
const wrapPhase = angle => ((angle % TAU) + TAU) % TAU;

function compactGroupOffsets(lobes, centre, gap, turn) {
  const count = lobes.length, masses = lobes.map(lobe => lobe[2] ** 2);
  const mass = masses.reduce((sum, value) => sum + value, 0);
  const distance = (i, j) => Math.max(Math.hypot(lobes[i][0] - lobes[j][0], lobes[i][1] - lobes[j][1]),
    lobes[i][2] + lobes[j][2] + gap);
  const first = distance(0, 1), target = [[0, 0], [first, 0]];
  if (count === 3) {
    const a = distance(0, 2), b = distance(1, 2), x = (first * first + a * a - b * b) / (2 * first);
    const sign = Math.sign((lobes[1][0] - lobes[0][0]) * (lobes[2][1] - lobes[0][1]) -
      (lobes[1][1] - lobes[0][1]) * (lobes[2][0] - lobes[0][0]));
    target.push([x, sign * Math.sqrt(Math.max(0, a * a - x * x))]);
  }
  const mean = [0, 1].map(axis => target.reduce((sum, point, i) => sum + point[axis] * masses[i], 0) / mass);
  const centred = target.map(point => [point[0] - mean[0], point[1] - mean[1]]);
  let dot = 0, cross = 0;
  centred.forEach(([x, y], i) => {
    const dx = lobes[i][0] - centre[0], dy = lobes[i][1] - centre[1];
    dot += masses[i] * (x * dx + y * dy);
    cross += masses[i] * (x * dy - y * dx);
  });
  const angle = Math.atan2(cross, dot) + turn, c = Math.cos(angle), s = Math.sin(angle);
  const aligned = centred.map(([x, y]) => [c * x - s * y, s * x + c * y]);
  const constraints = [];
  const add = (axes, bound) => {
    const average = [0, 1].map(axis => axes.reduce((sum, vector) => sum + vector[axis], 0) / mass);
    const direction = axes.map((vector, i) => [vector[0] / masses[i] - average[0], vector[1] / masses[i] - average[1]]);
    const norm = axes.reduce((sum, vector, i) => sum + vector[0] * direction[i][0] + vector[1] * direction[i][1], 0);
    constraints.push({ axes, direction, norm, bound, correction: 0 });
  };
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
    const original = [lobes[i][0] - lobes[j][0], lobes[i][1] - lobes[j][1]];
    for (const [vector, separate] of [[[aligned[i][0] - aligned[j][0], aligned[i][1] - aligned[j][1]], true], [original, false]]) {
      const length = Math.hypot(...vector), axes = Array.from({ length: count }, () => [0, 0]);
      axes[i] = vector.map(value => value / length);
      axes[j] = axes[i].map(value => -value);
      add(axes, separate ? lobes[i][2] + lobes[j][2] + gap - axes[i][0] * original[0] - axes[i][1] * original[1] : 0);
    }
  }
  for (let i = 0; i < count; i++) {
    const vector = [lobes[i][0] - centre[0], lobes[i][1] - centre[1]], length = Math.hypot(...vector);
    const axes = Array.from({ length: count }, () => [0, 0]);
    axes[i] = vector.map(value => value / length);
    add(axes, .011);
  }
  // Precompute minimum-displacement separation, rather than dilating every member by the worst pair's reach.
  // Weighted projections preserve the anchor; extra half-planes keep every member outward and every pair monotonic.
  const offsets = Array.from({ length: count }, () => [0, 0]);
  for (let iteration = 0; iteration < 256; iteration++) {
    let change = 0;
    for (const constraint of constraints) {
      const value = constraint.axes.reduce((sum, axis, i) => sum + axis[0] * offsets[i][0] + axis[1] * offsets[i][1], 0);
      const correction = Math.max(0, (constraint.bound - value - constraint.correction * constraint.norm) / constraint.norm);
      const step = constraint.correction + correction;
      offsets.forEach((offset, i) => {
        offset[0] += step * constraint.direction[i][0];
        offset[1] += step * constraint.direction[i][1];
      });
      change = Math.max(change, Math.abs(step));
      constraint.correction = -correction;
    }
    if (change < 1e-13) break;
  }
  return Object.freeze(offsets.map(offset => Object.freeze(offset)));
}

function createGroupMotion(model, seed, group, parent) {
  let state = (seed ^ Math.imul(parent + 1, 0x9e3779b9)) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const lobes = Object.freeze(model.CLUMP_PROFILES[group.clump].map(([x, y, radius]) => Object.freeze([x, y, radius])));
  const mass = lobes.reduce((sum, lobe) => sum + lobe[2] ** 2, 0);
  const centre = Object.freeze([0, 1].map(axis => lobes.reduce((sum, lobe) => sum + lobe[axis] * lobe[2] ** 2, 0) / mass));
  const breathMin = 1 - .025 * (1 + Math.sin(parent * 2.399963));
  const geometryMultiplier = group.radius >= CREAM_EDGE_PROFILE.largeFraction ?
    LARGE_GROUP_GEOMETRY_MULTIPLIER : GROUP_GEOMETRY_MULTIPLIER;
  let duration = 0;
  const cycles = Object.freeze(Array.from({ length: GROUP_MOTION_PROFILE.cycles }, () => {
    const period = 16 + random() * 12, joined = .16 + random() * .10, held = .12 + random() * .08;
    const gap = (GROUP_MOTION_PROFILE.gapFraction + random() * (GROUP_MOTION_PROFILE.maxGapFraction - GROUP_MOTION_PROFILE.gapFraction)) /
      (group.radius * geometryMultiplier * breathMin);
    const offsets = compactGroupOffsets(lobes, centre, gap, (random() - .5) * .12);
    const cycle = Object.freeze({ start: duration, period, joined, held, offsets });
    duration += period;
    return cycle;
  }));
  return Object.freeze({ lobes, centre, geometryMultiplier, cycles, duration, offset: random() * cycles[0].period * .12 });
}

export function sampleGroupMotion(motion, seconds) {
  if (!motion || !Array.isArray(motion.cycles) || !Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError('A production group motion recipe and nonnegative finite time are required.');
  }
  const time = (seconds + motion.offset) % motion.duration;
  const index = motion.cycles.findIndex(cycle => time < cycle.start + cycle.period);
  const cycle = motion.cycles[index], phase = (time - cycle.start) / cycle.period;
  const ramp = (1 - cycle.joined - cycle.held) / 2;
  let fraction, stage;
  if (phase <= cycle.joined) { fraction = 0; stage = 'joined'; }
  else if (phase < cycle.joined + ramp) { fraction = (phase - cycle.joined) / ramp; stage = 'repelling'; }
  else if (phase <= cycle.joined + ramp + cycle.held) { fraction = 1; stage = 'separated'; }
  else { fraction = (1 - phase) / ramp; stage = 'attracting'; }
  const amount = fraction * fraction * fraction * (10 + fraction * (-15 + fraction * 6));
  const lobeState = motion.lobes.map(([x, y, radius], lobe) =>
    [x + cycle.offsets[lobe][0] * amount, y + cycle.offsets[lobe][1] * amount, radius]);
  return { cycle: index, phase, amount, stage, lobeState };
}

export function createProductionRecipe(model, seed) {
  const base = model.createSceneRecipe(seed);
  if (model.CLUMP_PROFILES.some(profile => profile.length > 3)) throw new RangeError('Production groups support at most three lobes.');
  const groupCount = Math.ceil(base.groupCount * 1.5), extras = [];
  for (let index = 0; index < groupCount - base.groupCount; index++) {
    const original = base.clumps[2 + index % (base.groupCount - 2)];
    const side = index % 2 ? 'right' : 'left';
    extras.push(Object.freeze({ ...original, side, x: side === 'left' ? .16 : .84,
      y: .13 + ((original.y + .37 * (index + 1)) % .74) }));
  }
  // Append, rather than insert, so every original group's and droplet's motion index is unchanged.
  const clumps = Object.freeze([...base.clumps, ...extras]), edgeGroups = [];
  clumps.forEach((group, parent) => {
    if (group.kind === 'group' && group.radius >= CREAM_EDGE_PROFILE.largeFraction) {
      edgeGroups.push(Object.freeze({ parent, side: edgeGroups.length % 2 ? 'right' : 'left' }));
    }
  });
  const groupMotions = Object.freeze(clumps.map((group, parent) =>
    group.kind === 'group' ? createGroupMotion(model, seed, group, parent) : null));
  return Object.freeze({ ...base, baseGroupCount: base.groupCount, groupCount, clumps, groupMotions,
    edgeGroups: Object.freeze(edgeGroups) });
}

export function productionEdgeLayout(model, recipe, width, height) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Positive viewport dimensions are required for cream edge placement.');
  }
  const unit = Math.min(width, height), profile = CREAM_EDGE_PROFILE;
  const glassWidth = Math.min(profile.glassMaxWidth, Math.max(0, width - profile.glassGutter));
  const glassLeft = (width - glassWidth) / 2, glassRight = width - glassLeft;
  const intrusion = width >= profile.wideFrom ? profile.wideIntrusion : profile.narrowIntrusion;
  const leftLimit = glassLeft + intrusion, rightLimit = glassRight - intrusion;
  const sideLobes = { left: 0, right: 0 };
  for (const entry of recipe.edgeGroups) {
    sideLobes[entry.side] += model.CLUMP_PROFILES[recipe.clumps[entry.parent].clump].length;
  }
  const groups = recipe.edgeGroups.map(({ parent, side }) => {
    const seed = recipe.clumps[parent], lobes = model.CLUMP_PROFILES[seed.clump], motion = recipe.groupMotions[parent];
    const edges = lobes.map(([x, , radius], lobe) => {
      const values = [x - radius, x + radius];
      for (const cycle of motion.cycles) values.push(x + cycle.offsets[lobe][0] - radius, x + cycle.offsets[lobe][0] + radius);
      return { min: Math.min(...values), max: Math.max(...values) };
    });
    // Every seeded cycle interpolates between these exact endpoints; piece radii never shrink.
    const phase = Math.sin(parent * 2.399963), breathMax = 1 + .025 * (1 - phase);
    const breathMin = 1 - .025 * (1 + phase), radius = seed.radius * unit * motion.geometryMultiplier;
    const leftOffsets = edges.map(edge => edge.min * radius * (edge.min < 0 ? breathMax : breathMin));
    const rightOffsets = edges.map(edge => edge.max * radius * (edge.max > 0 ? breathMax : breathMin));
    const minOffset = Math.min(...leftOffsets), maxOffset = Math.max(...rightOffsets);
    const orbit = seed.orbit[0] * unit;
    const blend = unit * .040;
    // Projected distance bounds retain lobe separation, avoiding excessive padding that hides edge artwork.
    const projectedLeft = leftOffsets.reduce((a, b) => model.smoothUnion(a, b, blend));
    const projectedRight = rightOffsets.reduce((a, b) => -model.smoothUnion(-a, -b, blend));
    const otherUnionMargin = Math.max(0, sideLobes[side] - lobes.length) * blend / 4;
    const unionMargin = Math.max(minOffset - projectedLeft, projectedRight - maxOffset) + otherUnionMargin;
    // Original shadow is displaced +6px; fwidth AA needs at most 4 CSS pixels at the minimum .5 scale.
    const shadowLeft = Math.max(4, unit * .034 - 6), shadowRight = Math.max(4, unit * .034 + 6);
    const minX = seed.x * width - orbit + minOffset - unionMargin - shadowLeft;
    const maxX = seed.x * width + orbit + maxOffset + unionMargin + shadowRight;
    const translationX = side === 'left' ? leftLimit - maxX : rightLimit - minX;
    return { parent, side, translationX, envelopeMinX: minX + translationX,
      envelopeMaxX: maxX + translationX, unionMargin, otherUnionMargin, shadowLeft, shadowRight, orbit, breathMin, breathMax };
  });
  return { glassLeft, glassRight, intrusion, leftLimit, rightLimit, groups };
}

export function sampleProductionScene(model, recipe, width, height, seconds, spawns = []) {
  if (!Array.isArray(spawns) || spawns.length > CREAM_MAX_SPAWNS) throw new RangeError('At most eight strawberry spawns are supported.');
  const sampled = model.sampleScoops(model.seedScoops(width, height, recipe), seconds, width, height);
  const edgeLayout = productionEdgeLayout(model, recipe, width, height);
  const translations = new Map(edgeLayout.groups.map(group => [group.parent, group.translationX]));
  const main = [], attached = [];
  sampled.forEach((scoop, parent) => {
    const group = scoop.kind === 'group';
    const lobeState = group ? sampleGroupMotion(recipe.groupMotions[parent], seconds).lobeState : scoop.lobeState;
    // Expand one validated group at a time: the immutable study's aggregate capacity is deliberately smaller.
    for (const primitive of model.expandScoops([{ ...scoop, x: scoop.x + (translations.get(parent) || 0),
      lobeState, radius: scoop.radius * (group ? recipe.groupMotions[parent].geometryMultiplier : CREAM_GEOMETRY_MULTIPLIER) }])) {
      (primitive.lobe === 0 ? main : attached).push({ ...primitive, parent });
    }
  });
  const primitives = [...main, ...attached], ambientCount = primitives.length;
  spawns.forEach((spawn, index) => {
    validateSpawn(spawn);
    const age = Math.max(0, seconds - spawn.born), phase = wrapPhase(spawn.id * 2.399963);
    const unit = Math.min(width, height);
    const x = spawn.x * width + unit * .012 * (Math.sin(phase + age * .31) - Math.sin(phase));
    const y = spawn.y * height + unit * .009 * (Math.sin(phase + age * .23) - Math.sin(phase));
    primitives.push({ x: Math.max(0, Math.min(width, x)), y: Math.max(0, Math.min(height, y)),
      radius: unit * CREAM_SPAWN_BASE_RADIUS * SPAWN_GEOMETRY_MULTIPLIER *
        (1 + .022 * (Math.sin(phase + age * model.MOTION_PROFILE.breathRate) - Math.sin(phase))),
      peak: 0, parent: sampled.length + index, lobe: 0, spawnId: spawn.id,
      spawnShape: spawn.shape ?? createSpawnShape(recipe.seed, spawn.id) });
  });
  if (primitives.length > CREAM_MAX_PRIMITIVES) throw new RangeError('Production cream primitive capacity exceeded.');
  return { primitives, ambientCount, strawberryStart: spawns.length ? ambientCount : -1 };
}

export function createSpawnShape(seed, id) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(id) || id < 1) {
    throw new RangeError('An unsigned scene seed and positive safe spawn identity are required.');
  }
  let state = (seed ^ Math.imul(id >>> 0, 0x85ebca6b) ^ Math.imul(Math.floor(id / 0x100000000), 0xc2b2ae35)) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  return Object.freeze({ angle: random() * TAU, aspect: .70 + random() * .14,
    phase: random() * TAU, kind: Math.floor(random() * 3) });
}

function validateSpawnShape(shape) {
  // GPU-read descriptors may round a valid endpoint by one Float32 unit.
  if (!shape || ![shape.angle, shape.aspect, shape.phase].every(Number.isFinite) ||
      shape.angle < 0 || shape.angle > Math.fround(TAU) || shape.phase < 0 || shape.phase > Math.fround(TAU) ||
      shape.aspect < Math.fround(SPAWN_SHAPE_PROFILE.minAspect) || shape.aspect > SPAWN_SHAPE_PROFILE.maxAspect ||
      !Number.isInteger(shape.kind) || shape.kind < 0 || shape.kind > 2) {
    throw new RangeError('A finite, bounded spawn shape is required.');
  }
}

export function spawnShapePoint(x, y, shape) {
  validateSpawnShape(shape);
  if (![x, y].every(Number.isFinite)) throw new RangeError('Finite spawn-local coordinates are required.');
  const c = Math.cos(shape.angle), s = Math.sin(shape.angle);
  const qx = c * x + s * y, qy = (-s * x + c * y) / shape.aspect;
  if (qx * qx + qy * qy < 1e-10) return { x: qx, y: qy };
  const theta = Math.atan2(qy, qx);
  const a = shape.kind === 1 ? .10 : .015;
  const b = shape.kind === 0 ? .035 : .055;
  const d = shape.kind === 2 ? .10 : .025;
  const radial = SPAWN_SHAPE_PROFILE.extent *
    (1 + a * Math.cos(theta + shape.phase) + b * Math.cos(2 * theta - shape.phase) +
      d * Math.sin(3 * theta + 2 * shape.phase)) / (1 + a + b + d);
  return { x: qx / radial, y: qy / radial };
}

export function creamPrimitiveDistance(primitive, point) {
  if (!primitive.spawnShape) return Math.hypot(point.x - primitive.x, point.y - primitive.y) - primitive.radius;
  const q = spawnShapePoint((point.x - primitive.x) / primitive.radius, (point.y - primitive.y) / primitive.radius, primitive.spawnShape);
  return (Math.hypot(q.x, q.y) - 1) * primitive.radius;
}

function validateSpawn(spawn) {
  if (!spawn || !Number.isSafeInteger(spawn.id) || spawn.id < 1 ||
      ![spawn.x, spawn.y, spawn.born].every(Number.isFinite) ||
      spawn.x < 0 || spawn.x > 1 || spawn.y < 0 || spawn.y > 1 || spawn.born < 0) {
    throw new RangeError('A positive spawn identity, normalized position and nonnegative birth time are required.');
  }
  if (spawn.shape !== undefined) validateSpawnShape(spawn.shape);
}

export function appendCreamSpawn(spawns, spawn, seed = 0) {
  if (!Array.isArray(spawns) || spawns.length > CREAM_MAX_SPAWNS) throw new RangeError('A bounded spawn queue is required.');
  spawns.forEach(validateSpawn);
  validateSpawn(spawn);
  const shape = spawn.shape ?? createSpawnShape(seed, spawn.id);
  return Object.freeze([...spawns.slice(-(CREAM_MAX_SPAWNS - 1)),
    Object.freeze({ ...spawn, shape: Object.freeze({ ...shape }) })]);
}

export function sampleProductionTrail(model, trail, cursor) {
  return model.sampleTrail(trail, cursor).map(point => ({
    x: cursor.x + (point.x - cursor.x) * CREAM_TRAIL_LENGTH / model.TRAIL_PROFILE.lengthScale,
    y: cursor.y + (point.y - cursor.y) * CREAM_TRAIL_LENGTH / model.TRAIL_PROFILE.lengthScale,
  }));
}

function ambientDistance(model, primitives, point, blend) {
  let distance = 100000;
  for (const p of primitives) distance = model.smoothUnion(distance, creamPrimitiveDistance(p, point), blend);
  return distance;
}

export function creamFieldDistances(model, primitives, cursor, shape, path, width, height, point) {
  const radius = model.cursorRadius(width, height), blend = Math.min(width, height) * .04;
  const warped = cursorShapePoint((point.x-cursor.x)/radius, (point.y-cursor.y)/radius, shape);
  const head = Math.hypot(warped.x, warped.y)*radius-radius;
  let tail = 100000, lead = cursor;
  path.forEach((end, index) => {
    const dx = end.x-lead.x, dy = end.y-lead.y, lengthSquared = dx*dx+dy*dy;
    if (lengthSquared >= .25) {
      const t = Math.max(0, Math.min(1, ((point.x-lead.x)*dx+(point.y-lead.y)*dy)/lengthSquared));
      const progress = (index+t)/model.TRAIL_PROFILE.links;
      const r = radius*(model.TRAIL_PROFILE.startRadius+(model.TRAIL_PROFILE.endRadius-model.TRAIL_PROFILE.startRadius)*progress);
      tail = Math.min(tail, Math.hypot(point.x-lead.x-t*dx, point.y-lead.y-t*dy)-r);
    }
    lead = end;
  });
  const background = ambientDistance(model, primitives, point, blend), tailBlend = Math.min(blend*.4, radius*.4);
  return { background, head, tail, cursor: model.smoothUnion(head, tail, tailBlend),
    shared: model.smoothUnion(model.smoothUnion(background, head, blend), tail, tailBlend) };
}

export function creamContactState(model, primitives, cursor, shape, path, width, height) {
  const radius = model.cursorRadius(width, height), blend = Math.min(width, height)*.04;
  const tailBlend = Math.min(blend*.4, radius*.4);
  let head = false, tail = false;
  const candidates = primitives.map((p, index) => ({ p, index })).filter(({ p }) =>
    Math.hypot(cursor.x-p.x, cursor.y-p.y) < p.radius+radius*CURSOR_SHAPE_PROFILE.maxExtent+blend*2);
  if (candidates.length) {
    for (let i = 0; i < 32 && !head; i++) {
      const angle = i*TAU/32, x = Math.cos(angle), y = Math.sin(angle), q = cursorShapePoint(x, y, shape);
      const reach = radius/Math.hypot(q.x, q.y);
      head = ambientDistance(model, primitives, { x: cursor.x+x*reach, y: cursor.y+y*reach }, blend) < blend+.5;
    }
  }
  let lead = cursor;
  path.forEach((end, index) => {
    const dx = end.x-lead.x, dy = end.y-lead.y, lengthSquared = dx*dx+dy*dy;
    if (!tail && lengthSquared >= .25) {
      for (const p of primitives) {
        const t = Math.max(0, Math.min(1, ((p.x-lead.x)*dx+(p.y-lead.y)*dy)/lengthSquared));
        const widest = radius*(model.TRAIL_PROFILE.startRadius+
          (model.TRAIL_PROFILE.endRadius-model.TRAIL_PROFILE.startRadius)*index/model.TRAIL_PROFILE.links);
        if (Math.hypot(p.x-lead.x-t*dx, p.y-lead.y-t*dy) > p.radius+widest+blend+tailBlend+.5) continue;
        for (const fraction of [0, t, .5, 1]) {
          const point = { x: lead.x+fraction*dx, y: lead.y+fraction*dy };
          const r = radius*(model.TRAIL_PROFILE.startRadius+
            (model.TRAIL_PROFILE.endRadius-model.TRAIL_PROFILE.startRadius)*(index+fraction)/model.TRAIL_PROFILE.links);
          if (ambientDistance(model, primitives, point, blend) < r+tailBlend+.5) { tail = true; break; }
        }
        if (tail) break;
      }
    }
    lead = end;
  });
  return { active: head || tail, head, tail };
}

function excludedCreamTarget(event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  return path.some(node => node?.isContentEditable ||
    node?.closest?.('dialog, [data-open-notebook], a[data-photo], #cream-motion-control, #bakery-entrance, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

export function creamClickAllowed(event, gesture, now) {
  return !!(gesture && gesture.valid && gesture.released && event.isTrusted === true &&
    event.button === 0 && event.detail > 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
    Number.isFinite(now) && now >= gesture.ended && now - gesture.ended < 750 &&
    Number.isFinite(event.clientX) && Number.isFinite(event.clientY) &&
    Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= 10 &&
    (!event.pointerType || event.pointerType === gesture.type) && !excludedCreamTarget(event));
}

export function createCursorShape() {
  return { angle: 0, stretch: 1.13, phase: 0, energy: 0, velocityX: 0, velocityY: 0 };
}

function validateCursorShape(shape) {
  if (!shape || !['angle', 'stretch', 'phase', 'energy', 'velocityX', 'velocityY'].every(key => Number.isFinite(shape[key])) ||
      shape.stretch < CURSOR_SHAPE_PROFILE.minStretch || shape.stretch > CURSOR_SHAPE_PROFILE.maxStretch ||
      shape.energy < 0 || shape.energy > 1 || shape.phase < 0 || shape.phase >= TAU) {
    throw new RangeError('A finite, bounded cursor shape is required.');
  }
}

export function updateCursorShape(shape, displacement, elapsed, radius) {
  validateCursorShape(shape);
  if (!displacement || ![displacement.x, displacement.y, elapsed, radius].every(Number.isFinite) ||
      elapsed < 0 || radius <= 0) throw new RangeError('Finite head movement, positive radius and nonnegative elapsed time required.');
  if (elapsed === 0) return { ...shape };
  const dt = Math.min(elapsed, 50), seconds = dt / 1000, velocityWeight = 1 - Math.exp(-dt / 100);
  const velocityX = shape.velocityX + (displacement.x / seconds - shape.velocityX) * velocityWeight;
  const velocityY = shape.velocityY + (displacement.y / seconds - shape.velocityY) * velocityWeight;
  const speed = Math.hypot(velocityX, velocityY) / radius;
  const targetEnergy = Math.min(1, speed / 24);
  const energy = shape.energy + (targetEnergy - shape.energy) * (1 - Math.exp(-dt / (targetEnergy > shape.energy ? 150 : 400)));
  const phase = wrapPhase(shape.phase + seconds * (.78 + .32 * energy));
  const targetAngle = speed > .3 ? Math.atan2(velocityY, velocityX) : shape.angle + seconds * (.12 + .04 * Math.cos(phase));
  const turn = Math.atan2(Math.sin(targetAngle - shape.angle), Math.cos(targetAngle - shape.angle));
  const angle = wrapPhase(shape.angle + (speed > .3 ? turn * (1 - Math.exp(-dt / 220)) : turn));
  const desiredStretch = Math.max(CURSOR_SHAPE_PROFILE.minStretch,
    Math.min(CURSOR_SHAPE_PROFILE.maxStretch, 1.13 + .045 * Math.sin(phase) + .19 * energy));
  const stretch = shape.stretch + (desiredStretch - shape.stretch) * (1 - Math.exp(-dt / 140));
  return { angle, stretch, phase, energy, velocityX, velocityY };
}

export function resizeCursorShape(shape, scaleX, scaleY) {
  validateCursorShape(shape);
  if (![scaleX, scaleY].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('Positive cursor resize scales required.');
  return { ...shape, velocityX: shape.velocityX * scaleX, velocityY: shape.velocityY * scaleY,
    angle: wrapPhase(Math.atan2(Math.sin(shape.angle) * scaleY, Math.cos(shape.angle) * scaleX)) };
}

export function cursorShapePoint(x, y, shape) {
  validateCursorShape(shape);
  if (![x, y].every(Number.isFinite)) throw new RangeError('Finite normalized cursor coordinates required.');
  const cosine = Math.cos(shape.angle), sine = Math.sin(shape.angle);
  const localX = (cosine * x + sine * y) / shape.stretch;
  const localY = (-sine * x + cosine * y) * shape.stretch;
  const theta = Math.atan2(localY, localX), t = Math.min(1, Math.hypot(localX, localY) / .4);
  const wave = (Math.sin(2 * theta + shape.phase) * (.035 + .012 * shape.energy) +
    Math.cos(3 * theta - 2 * shape.phase) * (.024 + .008 * shape.energy)) * t * t * (3 - 2 * t);
  return { x: localX / (1 + wave), y: localY / (1 + wave) };
}

export function creamSampleTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Nonnegative finite cream motion time required.');
  return seconds * CREAM_MOTION_MULTIPLIER;
}

export function creamOutputSize(width, height, requestedRatio, limit = 16384, viewport = [limit, limit]) {
  if (![width, height, requestedRatio, limit, ...viewport].every(value => Number.isFinite(value) && value > 0) ||
      viewport.length !== 2) throw new RangeError('Positive viewport dimensions and graphics limits required.');
  const ratio = Math.min(1.5, requestedRatio, Math.sqrt(CREAM_PIXEL_BUDGET / (width * height)),
    Math.floor(limit) / width, Math.floor(limit) / height,
    Math.floor(viewport[0]) / width, Math.floor(viewport[1]) / height);
  if (ratio < .5) return null;
  const output = { width: Math.ceil(width * ratio), height: Math.ceil(height * ratio), ratio };
  return output.width * output.height <= 2_020_000 ? output : null;
}

export function creamLifecycle({ failed, lost, enabled = true, reduced, forced, printing, hidden,
  pageHidden, entrance, paused }) {
  const reason = failed ? 'failed' : lost ? 'context-lost' : !enabled ? 'disabled' :
    reduced ? 'reduced-motion' : forced ? 'forced-colors' : printing ? 'print' :
      pageHidden ? 'page-hidden' : hidden ? 'hidden' :
        entrance ? 'entrance' : '';
  return { visible: !reason, animate: !reason && !paused, reason: reason || (paused ? 'paused' : 'moving') };
}

export function creamPauseShortcut(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing || !event.altKey || !event.shiftKey ||
      event.ctrlKey || event.metaKey || event.key?.toLowerCase() !== 'p') return false;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  return !path.some(node => node?.isContentEditable ||
    node?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

export function creamElapsed(previous, now) {
  if (![previous, now].every(Number.isFinite) || previous < 0 || now < previous) {
    throw new RangeError('Monotonic nonnegative frame times required.');
  }
  return previous === 0 ? 0 : Math.min(50, now - previous);
}

export function creamModuleUrl(path, base = import.meta.url) {
  const url = new URL(path, base);
  url.search = new URL(base).search;
  return url.href;
}

class CreamContextLostError extends Error {
  constructor(cause) {
    super('Cream graphics context was lost.', { cause });
  }
}

function createRenderer(canvas, pointerCanvas, model, sources) {
  const gl = canvas.getContext('webgl2', {
    alpha: true, premultipliedAlpha: true, antialias: true, depth: false,
    preserveDrawingBuffer: true, powerPreference: 'low-power',
  });
  if (!gl) throw new Error('WebGL2 is unavailable.');
  const pointerContext = pointerCanvas.getContext('2d');
  if (!pointerContext) console.warn('The optional cream cursor is unavailable; retaining the native pointer.');
  const shaders = [], programs = [], materials = [];
  let program, geometry, uniforms, limit, viewport;
  const dispose = () => {
    if (geometry) gl.deleteBuffer(geometry);
    programs.forEach(value => gl.deleteProgram(value));
    shaders.forEach(shader => gl.deleteShader(shader));
    geometry = program = undefined;
    shaders.length = 0;
    programs.length = materials.length = 0;
  };
  const compile = (kind, source) => {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('Cream shader allocation failed.');
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Cream shader compilation failed: ${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(program, shader);
  };
  try {
    for (const [index, fragment] of [sources.fragment, sources.spawnFragment, sources.contactFragment, sources.spawnContactFragment].entries()) {
      program = gl.createProgram();
      if (!program) throw new Error('Cream program allocation failed.');
      programs.push(program);
      compile(gl.VERTEX_SHADER, sources.vertex);
      compile(gl.FRAGMENT_SHADER, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`Cream shader link failed: ${gl.getProgramInfoLog(program)}`);
      }
      shaders.forEach(shader => { gl.detachShader(program, shader); gl.deleteShader(shader); });
      shaders.length = 0;
      const position = gl.getAttribLocation(program, 'position');
      if (position < 0) throw new Error('Cream vertex position is unavailable.');
      const names = ['resolution', 'pixelRatio', 'viewSize', 'scoopCount', 'scoops',
        'trail', 'trailCount', 'headRadius', 'cursorTint', 'cursorShape'];
      if (index >= 1) names.push('strawberryStart');
      if (index >= 2) names.push('ambientCount', 'contactActive', 'contactPass', 'contactTrailCount', 'contactShape');
      if (index === 1 || index === 3) names.push('spawnShapeCount', 'spawnShapes');
      uniforms = Object.fromEntries(names.map(name =>
        [name, gl.getUniformLocation(program, ['scoops', 'trail', 'spawnShapes'].includes(name) ? `${name}[0]` : name)]));
      if (Object.values(uniforms).some(value => value === null)) throw new Error('Cream material uniforms are unavailable.');
      materials.push({ program, position, uniforms: { ambientCount: null, contactActive: null,
        contactPass: null, contactTrailCount: null, contactShape: null, strawberryStart: null,
        spawnShapeCount: null, spawnShapes: null, ...uniforms } });
    }
    geometry = gl.createBuffer();
    if (!geometry) throw new Error('Cream geometry allocation failed.');
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    viewport = Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS));
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Cream graphics setup failed.');
  } catch (error) {
    const contextLost = gl.isContextLost();
    dispose();
    throw contextLost ? new CreamContextLostError(error) : error;
  }
  const data = new Float32Array(CREAM_MAX_PRIMITIVES * 4);
  const pointerData = new Float32Array(CREAM_MAX_PRIMITIVES * 4);
  const contactData = new Float32Array(CREAM_MAX_PRIMITIVES * 4);
  const trailData = new Float32Array(model.TRAIL_PROFILE.links * 4);
  const spawnShapeData = new Float32Array(CREAM_MAX_SPAWNS * 4);
  return {
    dispose,
    outputSize(width, height, ratio) { return creamOutputSize(width, height, ratio, limit, viewport); },
    draw({ width, height, output, primitives, strawberryStart, cursor, shape, trail, pointerActive }) {
      if (gl.isContextLost()) throw new CreamContextLostError();
      gl.viewport(0, 0, canvas.width, canvas.height);
      const radius = model.cursorRadius(width, height), path = sampleProductionTrail(model, trail, cursor);
      const canPaintPointer = pointerActive && pointerContext && !pointerContext.isContextLost?.();
      const contact = canPaintPointer ? creamContactState(model, primitives, cursor, shape, path, width, height)
        : { active: false, head: false, tail: false };
      const count = primitives.length + (contact.active ? 1 : 0);
      if (count > CREAM_MAX_PRIMITIVES) throw new Error('Cream contact exceeds primitive capacity.');
      data.fill(0);
      primitives.forEach((scoop, index) => data.set([scoop.x, scoop.y, scoop.radius, scoop.peak], index * 4));
      const spawnCount = strawberryStart < 0 ? 0 : primitives.length - strawberryStart;
      if (spawnCount > CREAM_MAX_SPAWNS) throw new Error('Cream spawn shapes exceed capacity.');
      spawnShapeData.fill(0);
      for (let i = 0; i < spawnCount; i++) {
        const shape = primitives[strawberryStart + i].spawnShape;
        validateSpawnShape(shape);
        spawnShapeData.set([shape.angle, shape.aspect, shape.phase, shape.kind], i * 4);
      }
      if (contact.active) {
        contactData.set(data);
        contactData.set([cursor.x, cursor.y, radius, 0], primitives.length * 4);
      }
      let lead = cursor, segments = 0, pointerPainted = false;
      path.forEach((point, index) => {
        trailData.set([lead.x, lead.y, point.x, point.y], index * 4);
        if (Math.hypot(point.x - lead.x, point.y - lead.y) >= .5) segments++;
        lead = point;
      });
      let selected = -1;
      const select = index => {
        if (selected === index) return;
        selected = index;
        const material = materials[index];
        uniforms = material.uniforms;
        gl.useProgram(material.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry);
        gl.enableVertexAttribArray(material.position);
        gl.vertexAttribPointer(material.position, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
        gl.uniform1f(uniforms.pixelRatio, output.ratio);
        gl.uniform2f(uniforms.viewSize, width, height);
        gl.uniform4fv(uniforms.trail, trailData);
        gl.uniform1f(uniforms.headRadius, radius);
        gl.uniform1i(uniforms.spawnShapeCount, spawnCount);
        gl.uniform4fv(uniforms.spawnShapes, spawnShapeData);
      };
      const margin = radius * CURSOR_SHAPE_PROFILE.maxExtent + 14 + Math.min(width, height) * .04 +
        (contact.active ? Math.min(width, height)*.034 + 4 : 0);
      if (canPaintPointer) {
        select(contact.active ? (spawnCount ? 3 : 2) : 0);
        const points = [cursor, ...path];
        const left = Math.max(0, Math.floor((Math.min(...points.map(point => point.x)) - margin) * output.ratio));
        const top = Math.max(0, Math.floor((Math.min(...points.map(point => point.y)) - margin) * output.ratio));
        const right = Math.min(canvas.width, Math.ceil((Math.max(...points.map(point => point.x)) + margin) * output.ratio));
        const bottom = Math.min(canvas.height, Math.ceil((Math.max(...points.map(point => point.y)) + margin) * output.ratio));
        const cropWidth = right - left, cropHeight = bottom - top;
        if (cropWidth > 0 && cropHeight > 0) {
          if (pointerCanvas.width !== cropWidth) pointerCanvas.width = cropWidth;
          if (pointerCanvas.height !== cropHeight) pointerCanvas.height = cropHeight;
          Object.assign(pointerCanvas.style, { left: `${left / output.ratio}px`, top: `${top / output.ratio}px`,
            width: `${cropWidth / output.ratio}px`, height: `${cropHeight / output.ratio}px` });
          pointerData.fill(0);
          pointerData.set([cursor.x, cursor.y, radius, 0]);
          gl.uniform1i(uniforms.scoopCount, contact.active ? count : 1);
          gl.uniform4fv(uniforms.scoops, contact.active ? contactData : pointerData);
          gl.uniform1i(uniforms.trailCount, contact.active ? 0 : trail.length);
          gl.uniform1f(uniforms.cursorTint, contact.active ? 0 : 1);
          gl.uniform1i(uniforms.strawberryStart, contact.active ? strawberryStart : -1);
          if (contact.active) {
            gl.uniform4f(uniforms.cursorShape, 0, 1, 0, 0);
            gl.uniform1i(uniforms.ambientCount, primitives.length);
            gl.uniform1i(uniforms.contactActive, 1);
            gl.uniform1i(uniforms.contactPass, 1);
            gl.uniform1i(uniforms.contactTrailCount, trail.length);
            gl.uniform4f(uniforms.contactShape, shape.angle, shape.stretch, shape.phase, shape.energy);
          } else gl.uniform4f(uniforms.cursorShape, shape.angle, shape.stretch, shape.phase, shape.energy);
          // Shared-field foreground contains only the cursor/neck contribution, never the ambient crop.
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor(left, canvas.height - bottom, cropWidth, cropHeight);
          try {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            pointerContext.clearRect(0, 0, cropWidth, cropHeight);
            pointerContext.drawImage(canvas, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
            pointerPainted = true;
          } finally {
            gl.disable(gl.SCISSOR_TEST);
          }
        }
      }
      select(contact.active ? (spawnCount ? 3 : 2) : strawberryStart >= 0 ? 1 : 0);
      gl.uniform1i(uniforms.scoopCount, count);
      gl.uniform4fv(uniforms.scoops, contact.active ? contactData : data);
      gl.uniform1i(uniforms.trailCount, 0);
      gl.uniform1f(uniforms.cursorTint, 0);
      gl.uniform1i(uniforms.strawberryStart, strawberryStart);
      gl.uniform4f(uniforms.cursorShape, 0, 1, 0, 0);
      gl.uniform1i(uniforms.contactActive, contact.active ? 1 : 0);
      gl.uniform1i(uniforms.contactPass, 0);
      gl.uniform1i(uniforms.ambientCount, primitives.length);
      gl.uniform1i(uniforms.contactTrailCount, contact.active ? trail.length : 0);
      if (contact.active) gl.uniform4f(uniforms.contactShape, shape.angle, shape.stretch, shape.phase, shape.energy);
      gl.disable(gl.SCISSOR_TEST);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (gl.isContextLost()) throw new CreamContextLostError();
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Cream material rendering failed.');
      return { pointerPainted, segments, radius, contact, primitiveCount: count, margin };
    },
  };
}

const instances = new WeakMap();

export function initCreamEffect({ model } = {}) {
  const layer = document.getElementById('cream-effects');
  if (!layer || document.body.dataset.creamEffects !== 'enabled') return Promise.resolve();
  if (instances.has(layer)) return instances.get(layer);
  const instance = initialize(layer, model);
  instances.set(layer, instance);
  return instance;
}

async function initialize(layer, model) {
  const canvas = document.getElementById('cream-material');
  const pointerCanvas = document.getElementById('cream-cursor');
  const control = document.getElementById('cream-motion-control');
  const button = document.getElementById('cream-motion-toggle');
  const entrance = document.getElementById('bakery-entrance');
  const body = document.body;
  const revision = new URL(import.meta.url).searchParams.get('v') || 'unversioned';
  let renderer, sources, recipe, output, frame, heartbeat, overlays, controlsObserver, stylesObserver;
  let width = 0, height = 0, ratio = 0, paintCount = 0, motionTime = 0, lastTime = 0;
  let lastPaintTime = 0, clampedTime = 0, lastContact = false;
  let paused = false, lost = false, failed = false, disposed = false, pageHidden = false, printEvent = false;
  let blurred = !document.hasFocus(), pointerPresent = false, dirty = true, refreshing = false;
  let cursor = { x: 0, y: 0 }, target = { ...cursor }, trail;
  let cursorShape = createCursorShape();
  let spawns = [], spawnSequence = 0, gesture;
  const events = new AbortController();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const forced = matchMedia('(forced-colors: active)');
  const printing = matchMedia('print');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const setData = values => {
    for (const node of [layer, canvas]) if (node) {
      for (const [key, value] of Object.entries(values)) {
        const text = String(value);
        if (node.dataset[key] !== text) node.dataset[key] = text;
      }
    }
  };
  const nativePointer = () => {
    body.classList.remove('cream-cursor-active');
    if (pointerCanvas) pointerCanvas.hidden = true;
    setData({ pointerActive: false });
  };
  const stop = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    clearInterval(heartbeat);
    heartbeat = undefined;
    lastTime = 0;
    nativePointer();
  };
  const hide = reason => {
    if (lastContact) dirty = true;
    stop();
    pointerPresent = false;
    gesture = undefined;
    layer.hidden = true;
    if (control) control.hidden = true;
    body.classList.remove('has-cream-effects');
    setData({ state: reason, paused, contactActive: false, contactHead: false, contactTrail: false });
  };
  const fail = error => {
    if (error instanceof CreamContextLostError) { loseGraphics(); return; }
    failed = true;
    hide('failed');
    renderer?.dispose();
    renderer = undefined;
    setData({ error: error instanceof Error ? error.message : String(error) });
    console.warn('The optional cream effect is unavailable; the normal website remains usable.', error);
  };
  const loseGraphics = () => {
    lost = true;
    hide('context-lost');
    renderer?.dispose();
    renderer = undefined;
    output = undefined;
    dirty = true;
  };
  const entranceVisible = () => !!entrance && !entrance.hidden &&
    getComputedStyle(entrance).display !== 'none' && getComputedStyle(entrance).visibility !== 'hidden';
  const lifecycle = () => creamLifecycle({ failed: failed || disposed, lost,
    enabled: body.dataset.creamEffects === 'enabled', reduced: motion.matches, forced: forced.matches,
    printing: printEvent || printing.matches, hidden: document.hidden, pageHidden,
    entrance: entranceVisible(), paused });
  const viewerOpen = () => !!document.querySelector('dialog[open]');
  const recoverFocus = () => {
    if (blurred && !document.hidden && document.hasFocus()) blurred = false;
  };
  const pointerFocused = () => !blurred && document.hasFocus() && fine.matches && !viewerOpen();
  const stylesReady = () => getComputedStyle(layer).getPropertyValue('--cream-effect-ready').trim() === '1';
  const controlFits = () => {
    const bounds = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      bounds.width >= 48 && bounds.height >= 48 && bounds.left >= 0 &&
      bounds.right <= innerWidth + .5 &&
      button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1;
  };
  const resize = () => {
    const nextWidth = innerWidth, nextHeight = innerHeight, nextRatio = devicePixelRatio || 1;
    if (width === nextWidth && height === nextHeight && ratio === nextRatio && output) return;
    const next = renderer.outputSize(nextWidth, nextHeight, nextRatio);
    if (!next) throw new Error('Viewport exceeds the cream output budget or minimum half-resolution scale.');
    if (width && height) {
      const sx = nextWidth / width, sy = nextHeight / height;
      cursor = { x: cursor.x * sx, y: cursor.y * sy };
      target = { x: target.x * sx, y: target.y * sy };
      trail = trail.map(point => ({ x: point.x * sx, y: point.y * sy }));
      cursorShape = resizeCursorShape(cursorShape, sx, sy);
    } else {
      cursor = { x: nextWidth * .48, y: nextHeight * .27 };
      target = { ...cursor };
      trail = model.resetTrail(cursor);
    }
    width = nextWidth; height = nextHeight; ratio = nextRatio; output = next;
    canvas.width = output.width; canvas.height = output.height;
    dirty = true;
    nativePointer();
    const edgeLayout = productionEdgeLayout(model, recipe, width, height);
    setData({ pixelRatio: output.ratio, outputWidth: output.width, outputHeight: output.height,
      outputPixels: output.width * output.height, viewportWidth: width, viewportHeight: height,
      largeGroupCount: edgeLayout.groups.length, largeEdgeGroups: JSON.stringify(edgeLayout.groups),
      edgeIntrusionLimit: edgeLayout.intrusion, edgeLeftLimit: edgeLayout.leftLimit, edgeRightLimit: edgeLayout.rightLimit });
  };
  const render = animate => {
    const sampleTime = creamSampleTime(motionTime);
    const scene = sampleProductionScene(model, recipe, width, height, sampleTime, spawns);
    const painted = renderer.draw({ width, height, output, ...scene, cursor, shape: cursorShape, trail,
      pointerActive: animate && pointerFocused() && pointerPresent });
    lastContact = painted.contact.active;
    // Never hide the native cursor before both GPU passes and the overlay copy succeed.
    pointerCanvas.hidden = !painted.pointerPainted;
    body.classList.toggle('cream-cursor-active', painted.pointerPainted);
    if (painted.pointerPainted) pointerCanvas.dataset.paintCount = String(Number(pointerCanvas.dataset.paintCount || 0) + 1);
    lastPaintTime = performance.now();
    setData({ paintCount: ++paintCount, motionTime: motionTime.toFixed(4), sampleTime: sampleTime.toFixed(6),
      lastPaintTime: lastPaintTime.toFixed(2), clampedTime: clampedTime.toFixed(4), primitiveCount: painted.primitiveCount,
      scenePrimitiveCount: scene.primitives.length, contactActive: painted.contact.active,
      contactHead: painted.contact.head, contactTrail: painted.contact.tail, pointerCropMargin: painted.margin.toFixed(4),
      ambientPrimitiveCount: scene.ambientCount, strawberryStart: scene.strawberryStart,
      spawnCount: spawns.length, spawnRecords: JSON.stringify(spawns), scoopCount: recipe.clumps.length + spawns.length,
      cursorRadius: painted.radius.toFixed(3), cursorX: cursor.x.toFixed(4), cursorY: cursor.y.toFixed(4),
      pointerPose: JSON.stringify({ x: cursor.x, y: cursor.y, shape: cursorShape }),
      cursorAngle: cursorShape.angle.toFixed(6), cursorStretch: cursorShape.stretch.toFixed(6),
      cursorPhase: cursorShape.phase.toFixed(6), cursorEnergy: cursorShape.energy.toFixed(6),
      trailSegments: painted.segments, pointerActive: painted.pointerPainted });
    dirty = false;
  };
  const schedule = () => {
    if (frame === undefined && !disposed && lifecycle().animate) {
      frame = requestAnimationFrame(tick);
      if (heartbeat === undefined) heartbeat = setInterval(() => {
        if (!lifecycle().animate) { refresh(); return; }
        // A scheduled animation is not proof of progress if the browser stops delivering frames.
        if (performance.now() - lastPaintTime > 1500) {
          pointerPresent = false;
          nativePointer();
          setData({ state: 'waiting-for-frame' });
        }
      }, 1000);
    }
  };
  function tick(time) {
    frame = undefined;
    const state = lifecycle();
    if (!state.animate) { refresh(); return; }
    if (lastTime && time - lastTime < CREAM_FRAME_INTERVAL - .25) { schedule(); return; }
    try {
      resize();
      const elapsed = creamElapsed(lastTime, time);
      if (lastTime) clampedTime += Math.max(0, time - lastTime - elapsed) / 1000;
      motionTime += elapsed / 1000;
      if (!pointerFocused()) pointerPresent = false;
      const previousCursor = cursor;
      if (pointerPresent) cursor = model.followPointer(cursor, target, elapsed);
      cursorShape = updateCursorShape(cursorShape, { x: cursor.x - previousCursor.x, y: cursor.y - previousCursor.y },
        elapsed, model.cursorRadius(width, height));
      trail = model.followTrail(trail, cursor, elapsed, model.cursorRadius(width, height));
      lastTime = time;
      render(true);
      setData({ state: 'moving', paused });
      schedule();
    } catch (error) { fail(error); }
  }
  function refresh() {
    if (refreshing || disposed) return;
    const state = lifecycle();
    if (!state.visible) { hide(state.reason); return; }
    refreshing = true;
    try {
      const viewer = viewerOpen();
      setData({ viewerOpen: viewer });
      if (viewer) { pointerPresent = false; nativePointer(); }
      if (!stylesReady()) throw new Error('Cream styles are unavailable.');
      if (!renderer) { renderer = createRenderer(canvas, pointerCanvas, model, sources); dirty = true; output = undefined; }
      resize();
      layer.hidden = false;
      control.hidden = false;
      button.setAttribute('aria-pressed', String(paused));
      const label = paused ? 'Resume cream motion' : 'Pause cream motion';
      if (button.textContent !== label) button.textContent = label;
      // The normal-flow footer control must fit its column, but need not be in the viewport.
      if (!controlFits()) { hide('control-fit'); return; }
      if (lastContact && !state.animate) dirty = true;
      if (dirty) render(false);
      body.classList.add('has-cream-effects');
      setData({ state: state.animate ? (lastTime ? layer.dataset.state : 'scheduled') : state.reason, paused });
      if (state.animate) schedule();
      else stop();
    } catch (error) { fail(error); }
    finally { refreshing = false; }
  }
  const on = (node, type, handler, options = {}) =>
    node.addEventListener(type, handler, { ...options, signal: events.signal });
  const togglePause = () => {
    recoverFocus();
    paused = !paused;
    target = { ...cursor };
    stop();
    refresh();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    hide('disposed');
    events.abort();
    overlays?.disconnect();
    controlsObserver?.disconnect();
    stylesObserver?.disconnect();
    renderer?.dispose();
    renderer = undefined;
  };
  setData({ state: 'initializing', revision, paintCount: 0, motionTime: '0.0000', sampleTime: '0.000000',
    motionMultiplier: CREAM_MOTION_MULTIPLIER, lastPaintTime: 0, clampedTime: '0.0000', paused: false, error: '',
    contactActive: false, contactHead: false, contactTrail: false, scenePrimitiveCount: 0 });
  try {
    if (!canvas || !pointerCanvas || !control || !button) throw new Error('Cream enhancement markup is incomplete.');
    if (!model || !['createSceneRecipe', 'seedScoops', 'sampleScoops', 'expandScoops', 'followPointer',
      'cursorRadius', 'resetTrail', 'followTrail', 'sampleTrail'].every(name => typeof model[name] === 'function')) {
      throw new TypeError('A complete cream model is required.');
    }
    if (!stylesReady()) throw new Error('Cream styles are unavailable.');
    const material = await import(creamModuleUrl('./cream-material.mjs'));
    sources = material.createCreamShaders({ ...model, MAX_PRIMITIVES: CREAM_MAX_PRIMITIVES });
    const seed = globalThis.crypto?.getRandomValues
      ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296);
    recipe = createProductionRecipe(model, seed);
    setData({ sceneSeed: seed, groupCount: recipe.groupCount, baseGroupCount: recipe.baseGroupCount, dropletCount: recipe.dropletCount,
      scoopCount: recipe.clumps.length, seedCount: recipe.clumps.length,
      capacity: CREAM_MAX_PRIMITIVES, primitiveCapacity: CREAM_MAX_PRIMITIVES,
      logicalCapacity: CREAM_MAX_GROUPS + CREAM_MAX_DROPLETS + CREAM_MAX_SPAWNS,
      geometryMultiplier: CREAM_GEOMETRY_MULTIPLIER, groupGeometryMultiplier: GROUP_GEOMETRY_MULTIPLIER,
      largeGroupGeometryMultiplier: LARGE_GROUP_GEOMETRY_MULTIPLIER,
      groupMotionMode: 'repel-attract', groupMotionCycles: GROUP_MOTION_PROFILE.cycles, trailLengthScale: CREAM_TRAIL_LENGTH,
      spawnCapacity: CREAM_MAX_SPAWNS, spawnBaseRadiusFraction: CREAM_SPAWN_BASE_RADIUS,
      spawnGeometryMultiplier: SPAWN_GEOMETRY_MULTIPLIER, spawnShapeExtent: SPAWN_SHAPE_PROFILE.extent });
    button.setAttribute('aria-keyshortcuts', 'Alt+Shift+P');
    button.setAttribute('title', 'Pause or resume cream motion (Alt+Shift+P)');
    on(button, 'click', togglePause);
    on(window, 'keydown', event => {
      if (!renderer || !lifecycle().visible || !creamPauseShortcut(event)) return;
      event.preventDefault();
      togglePause();
    });
    const updatePointer = event => {
      recoverFocus();
      if (!lifecycle().animate || !pointerFocused() || event.pointerType !== 'mouse' || (event.buttons & ~1) ||
          (event.type === 'pointerup' && event.button !== 0)) {
        pointerPresent = false; nativePointer(); refresh(); return;
      }
      target = { x: event.clientX, y: event.clientY };
      if (!pointerPresent) { cursor = { ...target }; trail = model.resetTrail(cursor); }
      pointerPresent = target.x >= 0 && target.y >= 0 && target.x < innerWidth && target.y < innerHeight;
      refresh();
    };
    const trackGesture = event => {
      if (gesture && event.pointerId === gesture.pointerId &&
          Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10) gesture.valid = false;
    };
    on(window, 'pointermove', event => {
      trackGesture(event);
      updatePointer(event);
    }, { passive: true });
    on(window, 'pointerdown', event => {
      gesture = event.isTrusted === true && event.isPrimary !== false && event.button === 0 &&
        ['mouse', 'touch', 'pen'].includes(event.pointerType) && !event.altKey && !event.ctrlKey &&
        !event.metaKey && !event.shiftKey && lifecycle().animate && !viewerOpen() && !excludedCreamTarget(event)
        ? { pointerId: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY,
          began: performance.now(), valid: true, released: false } : undefined;
      updatePointer(event);
    }, { passive: true });
    on(window, 'pointerup', event => {
      trackGesture(event);
      if (gesture && event.pointerId === gesture.pointerId) {
        gesture.ended = performance.now();
        gesture.released = true;
        if (gesture.type !== 'mouse' && gesture.ended - gesture.began > 700) gesture.valid = false;
      }
      updatePointer(event);
    }, { passive: true });
    on(window, 'click', event => {
      const candidate = gesture;
      gesture = undefined;
      if (!renderer || !lifecycle().animate || viewerOpen() || !creamClickAllowed(event, candidate, performance.now())) return;
      if (event.clientX < 0 || event.clientY < 0 || event.clientX >= innerWidth || event.clientY >= innerHeight) return;
      spawns = appendCreamSpawn(spawns, { id: ++spawnSequence, x: event.clientX / innerWidth,
        y: event.clientY / innerHeight, born: creamSampleTime(motionTime) }, recipe.seed);
      // A normal animation frame paints the queue; a synchronous inactive repaint would erase the follower.
      schedule();
    }, { passive: true });
    on(document.documentElement, 'pointerleave', () => { pointerPresent = false; nativePointer(); }, { passive: true });
    on(window, 'pointercancel', () => { gesture = undefined; pointerPresent = false; nativePointer(); }, { passive: true });
    on(window, 'contextmenu', () => { gesture = undefined; pointerPresent = false; nativePointer(); }, { passive: true });
    on(window, 'blur', () => { gesture = undefined; blurred = true; pointerPresent = false; nativePointer(); refresh(); });
    on(window, 'focus', () => { recoverFocus(); refresh(); });
    on(document, 'focusin', () => { recoverFocus(); refresh(); });
    on(window, 'pagehide', () => { pageHidden = true; hide('page-hidden'); });
    on(window, 'pageshow', () => { pageHidden = false; recoverFocus(); refresh(); });
    on(document, 'visibilitychange', () => { recoverFocus(); refresh(); });
    on(window, 'beforeprint', () => { printEvent = true; refresh(); });
    on(window, 'afterprint', () => { printEvent = false; recoverFocus(); refresh(); });
    on(window, 'resize', refresh, { passive: true });
    on(window.visualViewport || window, 'resize', refresh, { passive: true });
    for (const query of [motion, forced, printing, fine]) on(query, 'change', () => {
      stop(); pointerPresent = false; refresh();
    });
    on(canvas, 'webglcontextlost', event => {
      event.preventDefault();
      loseGraphics();
    });
    on(canvas, 'webglcontextrestored', () => {
      if (failed || disposed) return;
      lost = false;
      recoverFocus();
      refresh();
    });
    overlays = new MutationObserver(records => {
      if (records.some(record => record.target === entrance || record.target.tagName === 'DIALOG' ||
          (record.target === body && record.attributeName === 'data-cream-effects') ||
          (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node =>
            node.nodeType === 1 && (node.matches('dialog') || node.querySelector('dialog')))))) refresh();
    });
    overlays.observe(body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['open', 'hidden', 'class', 'data-state', 'data-cream-effects'] });
    stylesObserver = new MutationObserver(refresh);
    stylesObserver.observe(document.head, { childList: true });
    if (typeof ResizeObserver === 'function') {
      controlsObserver = new ResizeObserver(() => { if (!control.hidden) refresh(); });
      controlsObserver.observe(control);
    }
    if (document.fonts) {
      on(document.fonts, 'loadingdone', refresh);
      on(document.fonts, 'loadingerror', refresh);
      document.fonts.ready.then(() => { if (!disposed) refresh(); });
    }
    on(window, 'load', refresh);
    blurred = !document.hasFocus();
    refresh();
  } catch (error) { fail(error); }
  return Object.freeze({ dispose });
}
