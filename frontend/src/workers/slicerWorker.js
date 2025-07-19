/* eslint-disable no-console */
import * as ClipperLib from 'js-clipper';
import * as THREE from 'three';

const CL_SCALE = 10_000_000;
const EPSILON = 1e-5;
const SNAP_TOLERANCE = 0.5;

/* ----------------------------------------------------------
   1.  Extract raw segments
---------------------------------------------------------- */
function getSliceSegments(posArr, bbox, heightStep, currentSliceVal, plane, sx, sy, sz) {
  const slices = [];
  if (!bbox?.min || !bbox?.max) return slices;

  let axis, min, max;
  if (plane === 'Z') {
    axis = 'z';
    min = bbox.min[2] * sz;
    max = bbox.max[2] * sz;
  } else if (plane === 'X') {
    axis = 'x';
    min = bbox.min[0] * sx;
    max = bbox.max[0] * sx;
  } else {
    axis = 'y';
    min = bbox.min[1] * sy;
    max = bbox.max[1] * sy;
  }

  const valuesToSlice =
    currentSliceVal !== null
      ? [currentSliceVal]
      : Array.from({ length: Math.floor((max - min) / heightStep) + 1 }, (_, i) => min + i * heightStep);

  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();

  valuesToSlice.forEach((val) => {
    const segs = [];
    for (let i = 0; i < posArr.length; i += 9) {
      v1.set(posArr[i] * sx, posArr[i + 1] * sy, posArr[i + 2] * sz);
      v2.set(posArr[i + 3] * sx, posArr[i + 4] * sy, posArr[i + 5] * sz);
      v3.set(posArr[i + 6] * sx, posArr[i + 7] * sy, posArr[i + 8] * sz);

      const tri = [v1, v2, v3];
      const pts = [];
      for (let j = 0; j < 3; j++) {
        const a = tri[j];
        const b = tri[(j + 1) % 3];
        const va = a[axis];
        const vb = b[axis];
        if ((va <= val + EPSILON && vb >= val - EPSILON) || (vb <= val + EPSILON && va >= val - EPSILON)) {
          if (Math.abs(vb - va) < EPSILON) continue;
          const t = (val - va) / (vb - va);
          const p = new THREE.Vector3().lerpVectors(a, b, t);
          pts.push(p);
        }
      }
      if (pts.length === 2 && pts[0].distanceTo(pts[1]) > EPSILON) {
        segs.push([pts[0].toArray(), pts[1].toArray()]);
      }
    }
    if (segs.length) slices.push({ value: val, segments: segs });
  });
  return slices;
}

/* ----------------------------------------------------------
   2.  Snap & trace helpers (unused in fallback mode)
---------------------------------------------------------- */
function snapPointsToGrid(raw, plane) {
  const out = [];
  const map = new Map();
  raw.forEach(([p1, p2]) => {
    let x1, y1, x2, y2;
    if (plane === 'Z') {
      x1 = p1[0];
      y1 = p1[1];
      x2 = p2[0];
      y2 = p2[1];
    } else if (plane === 'X') {
      x1 = p1[1];
      y1 = p1[2];
      x2 = p2[1];
      y2 = p2[2];
    } else {
      x1 = p1[0];
      y1 = p1[2];
      x2 = p2[0];
      y2 = p2[2];
    }
    const snap = 1 / SNAP_TOLERANCE;
    const snapX1 = Math.round(x1 * snap) / snap;
    const snapY1 = Math.round(y1 * snap) / snap;
    const snapX2 = Math.round(x2 * snap) / snap;
    const snapY2 = Math.round(y2 * snap) / snap;

    const key1 = `${snapX1},${snapY1}`;
    const key2 = `${snapX2},${snapY2}`;
    let int1 = map.get(key1);
    if (!int1) {
      int1 = { X: Math.round(snapX1 * CL_SCALE), Y: Math.round(snapY1 * CL_SCALE) };
      map.set(key1, int1);
    }
    let int2 = map.get(key2);
    if (!int2) {
      int2 = { X: Math.round(snapX2 * CL_SCALE), Y: Math.round(snapY2 * CL_SCALE) };
      map.set(key2, int2);
    }
    if (int1.X !== int2.X || int1.Y !== int2.Y) out.push([int1, int2]);
  });
  return out;
}

/* ----------------------------------------------------------
   3.  Worker entry
---------------------------------------------------------- */
self.onmessage = function (e) {
  const { type, payload } = e.data;
  if (type === 'sliceModel') {
    const { positionArray, bboxData, sliceHeight, currentSlice, slicingPlane, scaleX, scaleY, scaleZ, cutouts } = payload;

    const slicesData = getSliceSegments(positionArray, bboxData, sliceHeight, currentSlice, slicingPlane, scaleX, scaleY, scaleZ);

    // For now we use raw segments (fallback) – cutouts & tabWidth are passed for future extension
    const processed = slicesData.map(({ value, segments }) => ({
      value,
      contours: segments.flatMap((s) => [...s[0], ...s[1]]),
      isFallback: true,
      plane: slicingPlane,
      cutouts,
      tabWidth: sliceHeight * 0.6,
    }));

    self.postMessage({ type: 'slicingComplete', payload: processed });
  }
};
