/* eslint-disable no-console */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three-stdlib';
import { OrbitControls } from 'three-stdlib';
import { saveAs } from 'file-saver';

// ─── Worker import (CRA / Vite compatible) ─────────────────────────
const SlicerWorker = new Worker(new URL('../workers/slicerWorker.js', import.meta.url));

const PLYWOOD_BOX = { w: 200, h: 200, d: 300 };   // mm
const ALLOWED_THICKNESS = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const STLViewer = ({ stlFile }) => {
  /* ----------------------------------------------------------
     1.  Refs & State
  ---------------------------------------------------------- */
  const mountRef = useRef(null);
  const [sceneState, setSceneState] = useState({ scene: null, renderer: null, camera: null, controls: null });
  const [geometry, setGeometry] = useState(null);
  const [originalDimensions, setOriginalDimensions] = useState({ x: 0, y: 0, z: 0 });
  const [targetDimensions, setTargetDimensions] = useState({ width: 0, height: 0, depth: 0 });
  const [currentScale, setCurrentScale] = useState({ x: 1, y: 1, z: 1 });

  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 4,        // default 4 mm
    numSlices: 10,         // default 10 slices
    cutouts: 3,            // default 3 cut-outs
    showSlices: true,
    currentLayerIndex: 0,
    currentSliceValue: 0,
    singleSliceMode: false,
    slicingPlane: 'Z',
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  });

  const [showModelOutline, setShowModelOutline] = useState(true);
  const [showMiddleSlice, setShowMiddleSlice] = useState(false);
  const [debouncedSlicingParams, setDebouncedSlicingParams] = useState(slicingParams);
  const workerInstanceRef = useRef(null);

  /* ----------------------------------------------------------
     2.  Web Worker setup
  ---------------------------------------------------------- */
  useEffect(() => {
    workerInstanceRef.current = SlicerWorker;
    workerInstanceRef.current.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'slicingComplete') {
        clearSlices(sceneState.scene);
        payload.forEach(({ value: slicePlaneValue, contours, isFallback, plane }) => {
          if (!contours.length) return;
          const color = isFallback ? 0x00ff00 : 0xff0000;
          const sliceMaterial = new THREE.LineBasicMaterial({ color });
          const sliceGeometry = new THREE.BufferGeometry();
          sliceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(contours), 3));
          const sliceLine = isFallback
            ? new THREE.LineSegments(sliceGeometry, sliceMaterial)
            : new THREE.LineLoop(sliceGeometry, sliceMaterial);
          sliceLine.name = 'sliceLine';
          sceneState.scene.add(sliceLine);
        });
      }
    };
  }, [sceneState.scene]);

  /* ----------------------------------------------------------
     3.  Debounce slicing parameters
  ---------------------------------------------------------- */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSlicingParams(slicingParams), 200);
    return () => clearTimeout(t);
  }, [slicingParams]);

  /* ----------------------------------------------------------
     4.  Three scene setup (runs once)
  ---------------------------------------------------------- */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    while (mount.firstChild) mount.removeChild(mount.firstChild);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(50, 50, 100).normalize();
    scene.add(dir);

    const resize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', resize);
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    setSceneState({ scene, renderer, camera, controls });
    return () => {
      window.removeEventListener('resize', resize);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  /* ----------------------------------------------------------
     5.  STL loader + auto-scale to plywood box
  ---------------------------------------------------------- */
  useEffect(() => {
    if (!sceneState.scene || !stlFile) return;
    const loader = new STLLoader();
    loader.load(
      stlFile,
      (loadedGeometry) => {
        loadedGeometry.computeBoundingBox();
        setGeometry(loadedGeometry);

        const size = new THREE.Vector3();
        loadedGeometry.boundingBox.getSize(size);
        setOriginalDimensions({ x: size.x, y: size.y, z: size.z });

        const sx = PLYWOOD_BOX.w / size.x;
        const sy = PLYWOOD_BOX.h / size.y;
        const sz = PLYWOOD_BOX.d / size.z;
        const uniformScale = Math.min(sx, sy, sz);

        const newTarget = {
          width:  size.x * uniformScale,
          height: size.y * uniformScale,
          depth:  size.z * uniformScale,
        };
        setTargetDimensions(newTarget);

        const material = new THREE.MeshPhongMaterial({ color: 0x00aaff, transparent: false, opacity: 1 });
        const mesh = new THREE.Mesh(loadedGeometry, material);
        const center = new THREE.Vector3();
        loadedGeometry.boundingBox.getCenter(center);
        mesh.position.sub(center);
        mesh.name = 'stlMesh';

        const scene = sceneState.scene;
        const old = scene.getObjectByName('stlMesh');
        if (old) {
          scene.remove(old);
          old.geometry?.dispose();
          old.material?.dispose();
        }
        scene.add(mesh);

        const oldOut = scene.getObjectByName('modelOutline');
        if (oldOut) {
          scene.remove(oldOut);
          oldOut.geometry?.dispose();
          oldOut.material?.dispose();
        }
        const edges = new THREE.EdgesGeometry(loadedGeometry, 30);
        const outlineMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.8 });
        const outlines = new THREE.LineSegments(edges, outlineMat);
        outlines.name = 'modelOutline';
        outlines.visible = showModelOutline;
        scene.add(outlines);
      },
      undefined,
      (err) => console.error('STL load error:', err)
    );
  }, [stlFile, sceneState.scene, showModelOutline]);

  /* ----------------------------------------------------------
     6.  Scaling effect (updates mesh scale & camera)
  ---------------------------------------------------------- */
  useEffect(() => {
    if (!geometry || !sceneState.scene) return;
    const mesh = sceneState.scene.getObjectByName('stlMesh');
    if (!mesh) return;

    let sx = 1, sy = 1, sz = 1;
    if (originalDimensions.x > 0) sx = targetDimensions.width / originalDimensions.x;
    if (originalDimensions.y > 0) sy = targetDimensions.height / originalDimensions.y;
    if (originalDimensions.z > 0) sz = targetDimensions.depth / originalDimensions.z;

    mesh.scale.set(sx, sy, sz);
    setCurrentScale({ x: sx, y: sy, z: sz });

    if (sceneState.camera && sceneState.controls) {
      const size = new THREE.Vector3(originalDimensions.x * sx, originalDimensions.y * sy, originalDimensions.z * sz);
      const center = new THREE.Vector3();
      geometry.boundingBox.getCenter(center);
      center.multiply(new THREE.Vector3(sx, sy, sz));

      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = (sceneState.camera.fov * Math.PI) / 180;
      let camZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
      sceneState.camera.position.set(center.x, center.y, center.z + camZ);
      sceneState.camera.lookAt(center);
      sceneState.controls.target.copy(center);
      sceneState.controls.update();
    }

    setSlicingParams((p) => ({
      ...p,
      scaleX: sx,
      scaleY: sy,
      scaleZ: sz,
      currentLayerIndex: 0,
    }));
    setShowMiddleSlice(false);
  }, [targetDimensions, originalDimensions, geometry, sceneState.scene, sceneState.camera, sceneState.controls]);

  /* ----------------------------------------------------------
     7.  UI Handlers
  ---------------------------------------------------------- */
  const handleSliceHeightChange = (e) => {
    const val = parseFloat(e.target.value);
    if (!ALLOWED_THICKNESS.includes(val)) return;
    const range = getScaledMaxRangeValue() - getScaledMinRangeValue();
    const num = Math.min(30, Math.max(2, Math.floor(range / val) + 1));
    setSlicingParams((p) => ({ ...p, sliceHeight: val, numSlices: num, currentLayerIndex: 0, singleSliceMode: false }));
    setShowMiddleSlice(false);
  };

  const handlePlaneChange = (e) => {
    setSlicingParams((p) => ({ ...p, slicingPlane: e.target.value, currentLayerIndex: 0, singleSliceMode: false }));
    setShowMiddleSlice(false);
  };

  const handleToggleSlices = () => setSlicingParams((p) => ({ ...p, showSlices: !p.showSlices }));
  const handleToggleModelOutline = () => setShowModelOutline((v) => !v);
  const handleToggleMiddleSlice = () => {
    setShowMiddleSlice((v) => !v);
    setSlicingParams((p) => ({ ...p, singleSliceMode: false, showSlices: true }));
  };

  const handleStepChange = (e) => {
    const idx = parseInt(e.target.value, 10);
    const v = getScaledMinRangeValue() + idx * slicingParams.sliceHeight;
    setSlicingParams((p) => ({ ...p, currentLayerIndex: idx, currentSliceValue: v, singleSliceMode: true }));
    setShowMiddleSlice(false);
  };

  const handleToggleSingleSliceMode = () => {
    setSlicingParams((p) => ({ ...p, singleSliceMode: !p.singleSliceMode }));
    setShowMiddleSlice(false);
  };

  const handleTargetDimensionChange = (dim) => (e) => {
    const v = parseFloat(e.target.value);
    setTargetDimensions((p) => ({ ...p, [dim]: isNaN(v) ? 0 : v }));
  };

  /* ----------------------------------------------------------
     8.  Slice clearing & range helpers
  ---------------------------------------------------------- */
  const clearSlices = (scene) => {
    const slices = scene.children.filter((c) => c.name === 'sliceLine');
    slices.forEach((l) => {
      scene.remove(l);
      l.geometry?.dispose();
      l.material?.dispose();
    });
  };

  const getScaledMinRangeValue = useCallback(
    (g = geometry, pl = slicingParams.slicingPlane, sx = currentScale.x, sy = currentScale.y, sz = currentScale.z) => {
      if (!g?.boundingBox) return 0;
      const v = g.boundingBox.min[pl.toLowerCase()];
      return { X: v * sx, Y: v * sy, Z: v * sz }[pl];
    },
    [geometry, slicingParams.slicingPlane, currentScale]
  );

  const getScaledMaxRangeValue = useCallback(
    (g = geometry, pl = slicingParams.slicingPlane, sx = currentScale.x, sy = currentScale.y, sz = currentScale.z) => {
      if (!g?.boundingBox) return 100;
      const v = g.boundingBox.max[pl.toLowerCase()];
      return { X: v * sx, Y: v * sy, Z: v * sz }[pl];
    },
    [geometry, slicingParams.slicingPlane, currentScale]
  );

  /* ----------------------------------------------------------
     9.  Export helpers (SVG / DXF)
  ---------------------------------------------------------- */
const exportSVG = () => {
  if (!sceneState.scene) return;
  const lines = sceneState.scene.children.filter((c) => c.name === 'sliceLine');
  if (!lines.length) return console.log('No slices to export.');

  const plane = slicingParams.slicingPlane;
  let offsetX = 0;
  const sliceGap = 10;

  let pathData = '';
  let globalMinX = Infinity;
  let globalMinY = Infinity;
  let globalMaxX = -Infinity;
  let globalMaxY = -Infinity;

  lines.forEach((line) => {
    const pos = line.geometry.attributes.position;
    if (!pos || pos.count === 0) return;

    // Build 2-D points once
    const pts2D = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      let px, py;
      if (plane === 'Z') { px = x; py = y; }
      else if (plane === 'X') { px = z; py = y; }
      else { px = x; py = z; }

      pts2D.push({ x: px + offsetX, y: -py }); // SVG Y inverted
      globalMinX = Math.min(globalMinX, px + offsetX);
      globalMaxX = Math.max(globalMaxX, px + offsetX);
      globalMinY = Math.min(globalMinY, -py);
      globalMaxY = Math.max(globalMaxY, -py);
    }

    // Export every pair as a separate two-point path
    for (let i = 0; i < pts2D.length - 1; i += 2) {
      const p1 = pts2D[i];
      const p2 = pts2D[i + 1];
      pathData += `<path d="M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}" stroke="#ff0000" stroke-width="0.2" fill="none"/>\n`;
    }

    offsetX += (globalMaxX - globalMinX) + sliceGap;
  });

  if (!pathData) return;

  const w = globalMaxX - globalMinX;
  const h = globalMaxY - globalMinY;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="${globalMinX.toFixed(3)} ${globalMinY.toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)}">
${pathData}
</svg>`;
  saveAs(new Blob([svg], { type: 'image/svg+xml' }), 'slice.svg');
};

/* ------------------------------------------------------------------
   DXF Export – side view, every segment as separate two-point line
------------------------------------------------------------------ */
const exportDXF = () => {
  if (!sceneState.scene) return;
  const lines = sceneState.scene.children.filter((c) => c.name === 'sliceLine');
  if (!lines.length) return console.log('No slices to export.');

  const plane = slicingParams.slicingPlane;
  let offsetX = 0;
  const sliceGap = 10;

  let dxf = '0\nSECTION\n2\nENTITIES\n';

  lines.forEach((line) => {
    const pos = line.geometry.attributes.position;
    if (!pos || pos.count === 0) return;

    const pts2D = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      let px, py;
      if (plane === 'Z') { px = x; py = y; }
      else if (plane === 'X') { px = z; py = y; }
      else { px = x; py = z; }

      pts2D.push({ x: px + offsetX, y: py });
    }

    // Write every segment as separate LINE entity
    for (let i = 0; i < pts2D.length - 1; i += 2) {
      const p1 = pts2D[i];
      const p2 = pts2D[i + 1];
      dxf +=
        '0\nLINE\n8\n0\n10\n' +
        p1.x.toFixed(3) +
        '\n20\n' +
        p1.y.toFixed(3) +
        '\n30\n0\n11\n' +
        p2.x.toFixed(3) +
        '\n21\n' +
        p2.y.toFixed(3) +
        '\n31\n0\n';
    }

    const sliceWidth = Math.max(...pts2D.map((p) => p.x)) - Math.min(...pts2D.map((p) => p.x));
    offsetX += sliceWidth + sliceGap;
  });

  dxf += '0\nENDSEC\n0\nEOF';
  saveAs(new Blob([dxf], { type: 'application/dxf' }), 'slice.dxf');
};
  /* ----------------------------------------------------------
     10.  Slicing trigger (debounced)
  ---------------------------------------------------------- */
  useEffect(() => {
    if (!geometry || !workerInstanceRef.current) return;
    clearSlices(sceneState.scene);

    const min = getScaledMinRangeValue();
    const max = getScaledMaxRangeValue();
    const range = max - min;
    const num = Math.min(30, Math.max(2, Math.floor(range / debouncedSlicingParams.sliceHeight) + 1));
    const sliceVal = showMiddleSlice ? (min + max) / 2 : debouncedSlicingParams.singleSliceMode ? debouncedSlicingParams.currentSliceValue : null;

    const posArr = new Float32Array(geometry.attributes.position.array);
    const bbox = { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() };

    workerInstanceRef.current.postMessage({
      type: 'sliceModel',
      payload: {
        positionArray: posArr,
        bboxData: bbox,
        sliceHeight: debouncedSlicingParams.sliceHeight,
        currentSlice: sliceVal,
        slicingPlane: debouncedSlicingParams.slicingPlane,
        scaleX: currentScale.x,
        scaleY: currentScale.y,
        scaleZ: currentScale.z,
        cutouts: debouncedSlicingParams.cutouts,
      },
    });
  }, [debouncedSlicingParams, geometry, sceneState.scene, showMiddleSlice, currentScale, getScaledMinRangeValue, getScaledMaxRangeValue]);

  /* ----------------------------------------------------------
     11.  Render
  ---------------------------------------------------------- */
  const minR = getScaledMinRangeValue();
  const maxR = getScaledMaxRangeValue();
  const totalLayers = geometry ? Math.floor((maxR - minR) / slicingParams.sliceHeight) + 1 : 0;
  const modelDims = {
    x: (originalDimensions.x * currentScale.x).toFixed(2),
    y: (originalDimensions.y * currentScale.y).toFixed(2),
    z: (originalDimensions.z * currentScale.z).toFixed(2),
  };

  return (
    <div>
      <div style={{ padding: 10, background: '#282c34', color: '#fff', borderBottom: '1px solid #444', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <label>
          Slice thickness:
          <select value={slicingParams.sliceHeight} onChange={handleSliceHeightChange} style={{ marginLeft: 5 }}>
            {ALLOWED_THICKNESS.map((t) => (
              <option key={t} value={t}>{t} mm</option>
            ))}
          </select>
        </label>

        <label>
          Cut-outs (3-10):
          <select
            value={slicingParams.cutouts}
            onChange={(e) =>
              setSlicingParams((p) => ({ ...p, cutouts: Math.max(3, Math.min(10, parseInt(e.target.value, 10))) }))
            }
            style={{ marginLeft: 5 }}
          >
            {[...Array(8)].map((_, i) => (
              <option key={i + 3} value={i + 3}>{i + 3}</option>
            ))}
          </select>
        </label>

        <label>
          <input type="checkbox" checked={slicingParams.showSlices} onChange={handleToggleSlices} style={{ marginRight: 5 }} />
          Show Slices
        </label>

        <label>
          <input type="checkbox" checked={showModelOutline} onChange={handleToggleModelOutline} style={{ marginRight: 5 }} />
          Outline
        </label>

        <label>
          <input type="checkbox" checked={showMiddleSlice} onChange={handleToggleMiddleSlice} style={{ marginRight: 5 }} />
          Middle Slice
        </label>

        <label>
          Plane:
          <select value={slicingParams.slicingPlane} onChange={handlePlaneChange} style={{ marginLeft: 5 }}>
            <option value="Z">Z</option>
            <option value="X">X</option>
            <option value="Y">Y</option>
          </select>
        </label>

        <label>
          <input type="checkbox" checked={slicingParams.singleSliceMode} onChange={handleToggleSingleSliceMode} disabled={showMiddleSlice} style={{ marginRight: 5 }} />
          Single Slice
        </label>

        <label style={{ opacity: slicingParams.singleSliceMode && !showMiddleSlice ? 1 : 0.5 }}>
          Layer:
          <input
            type="range"
            min={0}
            max={totalLayers > 0 ? totalLayers - 1 : 0}
            step="1"
            value={slicingParams.currentLayerIndex}
            onChange={handleStepChange}
            disabled={!geometry || !slicingParams.singleSliceMode || totalLayers <= 1 || showMiddleSlice}
            style={{ marginLeft: 5, width: 120 }}
          />
          <span style={{ marginLeft: 5 }}>{slicingParams.currentSliceValue.toFixed(2)}</span>
        </label>

        <button onClick={exportSVG} style={{ padding: '3px 8px' }}>Export SVG</button>
        <button onClick={exportDXF} style={{ padding: '3px 8px' }}>Export DXF</button>

        {geometry && (
          <span style={{ fontSize: '0.85em' }}>
            Total Layers: {totalLayers} | Dimensions: L{modelDims.x} W{modelDims.y} H{modelDims.z}
          </span>
        )}
      </div>

      <div ref={mountRef} style={{ width: '100%', height: 'calc(100vh - 50px)' }} />
    </div>
  );
};

export default STLViewer;
