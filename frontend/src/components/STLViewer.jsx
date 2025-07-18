import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from "file-saver";

const STLViewer = ({ stlFile }) => {
  const mountRef = useRef(null);
  const [sceneState, setSceneState] = useState({ scene: null, renderer: null, camera: null, controls: null });
  const [geometry, setGeometry] = useState(null);
  const [boundingBox, setBoundingBox] = useState(null);
  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 2,
    showSlices: true,
    currentSliceValue: 0,
    stepThrough: false,
    slicingPlane: "Z",
  });

  // Update slicing parameters helpers
  const updateSliceParam = (key, val) => setSlicingParams(prev => ({ ...prev, [key]: val }));

  // Clear existing slices from scene
  const clearSlices = (scene) => {
    scene.children.filter(c => c.name === "sliceLine").forEach(c => scene.remove(c));
  };

  // Slice geometry along the selected plane
  const sliceSTL = (geometry, scene, heightStep, currentValue, plane) => {
    const pos = geometry.attributes.position;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bbox = geometry.boundingBox;

    let axis, min, max;
    switch (plane) {
      case "X": axis = "x"; min = bbox.min.x; max = bbox.max.x; break;
      case "Y": axis = "y"; min = bbox.min.y; max = bbox.max.y; break;
      default: axis = "z"; min = bbox.min.z; max = bbox.max.z; break;
    }

    const values = currentValue !== null ? [currentValue] : 
      Array.from({ length: Math.floor((max - min) / heightStep) + 1 }, (_, i) => min + i * heightStep);

    values.forEach(value => {
      const points = [];

      for (let i = 0; i < pos.count; i += 3) {
        const p1 = new THREE.Vector3().fromBufferAttribute(pos, i);
        const p2 = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
        const p3 = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
        const triangle = [p1, p2, p3];

        for (let j = 0; j < 3; j++) {
          const v1 = triangle[j], v2 = triangle[(j + 1) % 3];
          if ((v1[axis] <= value && v2[axis] >= value) || (v2[axis] <= value && v1[axis] >= value)) {
            const t = (value - v1[axis]) / (v2[axis] - v1[axis]);
            const x = v1.x + t * (v2.x - v1.x);
            const y = v1.y + t * (v2.y - v1.y);
            const z = v1.z + t * (v2.z - v1.z);
            points.push(new THREE.Vector3(x, y, z));
          }
        }
      }

      if (points.length > 1) {
        // Connect points into pairs as line segments
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const sliceLine = new THREE.LineSegments(geometry, material);
        sliceLine.name = "sliceLine";
        scene.add(sliceLine);
      }
    });
  };

  // Export the current slices as SVG and DXF
  const exportCurrentSlice = () => {
    const scene = sceneState.scene;
    if (!scene) return;

    const lines = scene.children.filter(c => c.name === "sliceLine");
    if (lines.length === 0) return alert("No slices to export!");

    // --- Build DXF content ---
    let dxfContent = "0\nSECTION\n2\nENTITIES\n";
    lines.forEach(line => {
      const pos = line.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 2) {
        const x1 = pos.getX(i).toFixed(3);
        const y1 = pos.getY(i).toFixed(3);
        const x2 = pos.getX(i + 1).toFixed(3);
        const y2 = pos.getY(i + 1).toFixed(3);
        dxfContent += `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0\n`;
      }
    });
    dxfContent += "0\nENDSEC\n0\nEOF";
    const dxfBlob = new Blob([dxfContent], { type: "application/dxf" });
    saveAs(dxfBlob, "slice.dxf");

    // --- Build SVG content with connected paths and red 0.05mm stroke ---
    let svgPaths = "";
    lines.forEach(line => {
      const pos = line.geometry.attributes.position;
      // Build continuous path from points pairs
      if (pos.count < 2) return;
      let pathData = `M ${pos.getX(0)},${-pos.getY(0)}`;
      for (let i = 1; i < pos.count; i++) {
        pathData += ` L ${pos.getX(i)},${-pos.getY(i)}`;
      }
      svgPaths += `<path d="${pathData}" stroke="red" stroke-width="0.05" fill="none"/>`;
    });

    const svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" 
     width="100%" height="100%" viewBox="0 0 200 200" 
     >
  ${svgPaths}
</svg>`;

    const svgBlob = new Blob([svgContent], { type: "image/svg+xml" });
    saveAs(svgBlob, "slice.svg");
  };

  // Init Three.js scene, camera, controls, lighting, renderer
  useEffect(() => {
    const mount = mountRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121212);

    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 50, 100).normalize();
    scene.add(ambientLight);
    scene.add(directionalLight);

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    setSceneState({ scene, renderer, camera, controls });

    return () => {
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // Load STL file, create mesh and add to scene
  useEffect(() => {
    if (!sceneState.scene || !stlFile) return;

    const loader = new STLLoader();
    loader.load(stlFile, (geom) => {
      geom.computeBoundingBox();
      setGeometry(geom);
      setBoundingBox(geom.boundingBox);

      const material = new THREE.MeshPhongMaterial({ color: 0x00aaff });
      const mesh = new THREE.Mesh(geom, material);

      // Center the mesh at origin
      const center = new THREE.Vector3();
      geom.boundingBox.getCenter(center);
      mesh.position.sub(center);
      mesh.name = "stlMesh";

      const scene = sceneState.scene;
      const oldMesh = scene.getObjectByName("stlMesh");
      if (oldMesh) scene.remove(oldMesh);
      scene.add(mesh);

      clearSlices(scene);

      if (slicingParams.showSlices) {
        sliceSTL(geom, scene, slicingParams.sliceHeight, slicingParams.stepThrough ? slicingParams.currentSliceValue : null, slicingParams.slicingPlane);
      }
    });
  }, [stlFile, sceneState, slicingParams]);

  // Update slices when slicing parameters change
  useEffect(() => {
    if (!geometry || !sceneState.scene) return;
    clearSlices(sceneState.scene);
    if (slicingParams.showSlices) {
      sliceSTL(geometry, sceneState.scene, slicingParams.sliceHeight, slicingParams.stepThrough ? slicingParams.currentSliceValue : null, slicingParams.slicingPlane);
    }
  }, [slicingParams, geometry, sceneState]);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 10, background: "#222", color: "#eee", fontSize: 14, display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
        {/* Bounding box dims */}
        {boundingBox && (
          <>
            <div><b>Width (X):</b> {(boundingBox.max.x - boundingBox.min.x).toFixed(2)} mm</div>
            <div><b>Height (Y):</b> {(boundingBox.max.y - boundingBox.min.y).toFixed(2)} mm</div>
            <div><b>Depth (Z):</b> {(boundingBox.max.z - boundingBox.min.z).toFixed(2)} mm</div>
          </>
        )}

        {/* Controls */}
        <label>
          Slice Height (mm):
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={slicingParams.sliceHeight}
            onChange={e => updateSliceParam("sliceHeight", parseFloat(e.target.value))}
            style={{ width: "70px", marginLeft: 6 }}
          />
        </label>

        <label>
          Plane:
          <select
            value={slicingParams.slicingPlane}
            onChange={e => updateSliceParam("slicingPlane", e.target.value)}
            style={{ marginLeft: 6 }}
          >
            <option value="Z">Z</option>
            <option value="X">X</option>
            <option value="Y">Y</option>
          </select>
        </label>

        <label>
          Show Slices:
          <input
            type="checkbox"
            checked={slicingParams.showSlices}
            onChange={() => updateSliceParam("showSlices", !slicingParams.showSlices)}
            style={{ marginLeft: 6 }}
          />
        </label>

        <label style={{ minWidth: 180 }}>
          Step Through:
          <input
            type="range"
            min={geometry?.boundingBox?.min[slicingParams.slicingPlane.toLowerCase()] || 0}
            max={geometry?.boundingBox?.max[slicingParams.slicingPlane.toLowerCase()] || 100}
            step="0.1"
            value={slicingParams.currentSliceValue}
            disabled={!slicingParams.stepThrough}
            onChange={e => updateSliceParam("currentSliceValue", parseFloat(e.target.value))}
            style={{ marginLeft: 6, width: 150 }}
          />
          <input
            type="checkbox"
            checked={slicingParams.stepThrough}
            onChange={e => updateSliceParam("stepThrough", e.target.checked)}
            style={{ marginLeft: 6 }}
          />
        </label>

        <button onClick={exportCurrentSlice} style={{ marginLeft: 10, padding: "4px 12px", cursor: "pointer" }}>
          Export SVG & DXF
        </button>
      </div>

      <div ref={mountRef} style={{ flexGrow: 1 }} />
    </div>
  );
};

export default STLViewer;
