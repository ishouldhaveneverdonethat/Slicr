import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from "file-saver";

const STLViewer = ({ stlFile }) => {
  // --- 1. Model and Geometry State ---
  const mountRef = useRef(null);
  const [sceneState, setSceneState] = useState({ scene: null, renderer: null, camera: null });
  const [geometry, setGeometry] = useState(null);

  // --- 3. Slicing Logic State ---
  const [slicingParams, setSlicingParams] = useState({
  sliceHeight: 2,
  showSlices: true,
  currentSlicePos: 0,
  stepThrough: false,
  slicingPlane: "Z",
  showOnlyCurrentSlice: false,
});

  // --- 4. UI Controls Handlers ---
  const handleSliceHeightChange = (e) => {
    setSlicingParams((p) => ({ ...p, sliceHeight: parseFloat(e.target.value) }));
  };

  const handlePlaneChange = (e) => {
    setSlicingParams((p) => ({ ...p, slicingPlane: e.target.value }));
  };

  const handleToggleSlices = () => {
    setSlicingParams((p) => ({ ...p, showSlices: !p.showSlices }));
  };

  const handleStepChange = (e) => {
    setSlicingParams((p) => ({
      ...p,
      currentSlice: parseFloat(e.target.value),
      stepThrough: true,
    }));
  };

  // --- 2. Scene Setup and Render ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Scene, camera, renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121212);

    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 50, 100).normalize();
    scene.add(directionalLight);

    // Animate
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Save to state
    setSceneState({ scene, renderer, camera });

    // Cleanup
    return () => {
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // --- 1. STL Loader & Mesh Setup ---
  useEffect(() => {
    if (!sceneState.scene || !stlFile) return;

    const loader = new STLLoader();
    loader.load(stlFile, (loadedGeometry) => {
      loadedGeometry.computeBoundingBox();
      setGeometry(loadedGeometry);

      const material = new THREE.MeshPhongMaterial({ color: 0x00aaff });
      const mesh = new THREE.Mesh(loadedGeometry, material);

      // Center mesh
      const center = new THREE.Vector3();
      loadedGeometry.boundingBox.getCenter(center);
      mesh.position.sub(center);
      mesh.name = "stlMesh";

      // Replace existing mesh
      const scene = sceneState.scene;
      const existing = scene.getObjectByName("stlMesh");
      if (existing) scene.remove(existing);
      scene.add(mesh);

      // Clear previous slices & add new if enabled
      clearSlices(scene);
      if (slicingParams.showSlices) {
  let singleSlice = null;
  if (slicingParams.showOnlyCurrentSlice || slicingParams.stepThrough) {
    singleSlice = slicingParams.currentSlicePos;
  }

  sliceSTL(
    geom,
    scene,
    slicingParams.sliceHeight,
    singleSlice,
    slicingParams.slicingPlane
  );
}

;
      }
    });
  }, [stlFile, sceneState, slicingParams]);

  // --- 6. Utility Functions ---
  const clearSlices = (scene) => {
    const slices = scene.children.filter((child) => child.name === "sliceLine");
    slices.forEach((line) => scene.remove(line));
  };

  // --- 3. Slicing Logic ---
  const sliceSTL = (geometry, scene, heightStep, currentSliceVal, plane) => {
    const pos = geometry.attributes.position;
    const bbox = geometry.boundingBox;

    let axis, min, max;
    if (plane === "Z") {
      axis = "z";
      min = bbox.min.z;
      max = bbox.max.z;
    } else if (plane === "X") {
      axis = "x";
      min = bbox.min.x;
      max = bbox.max.x;
    } else {
      axis = "y";
      min = bbox.min.y;
      max = bbox.max.y;
    }

    // Determine slice values
    const values =
      currentSliceVal !== null
        ? [currentSliceVal]
        : Array.from({ length: Math.floor((max - min) / heightStep) + 1 }, (_, i) => min + i * heightStep);

    values.forEach((value) => {
      const points = [];

      for (let i = 0; i < pos.count; i += 3) {
        const p1 = new THREE.Vector3().fromBufferAttribute(pos, i);
        const p2 = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
        const p3 = new THREE.Vector3().fromBufferAttribute(pos, i + 2);

        const triangle = [p1, p2, p3];
        for (let j = 0; j < 3; j++) {
          const v1 = triangle[j];
          const v2 = triangle[(j + 1) % 3];

          if (
            (v1[axis] <= value && v2[axis] >= value) ||
            (v2[axis] <= value && v1[axis] >= value)
          ) {
            const t = (value - v1[axis]) / (v2[axis] - v1[axis]);
            const x = v1.x + t * (v2.x - v1.x);
            const y = v1.y + t * (v2.y - v1.y);
            const z = v1.z + t * (v2.z - v1.z);
            points.push(new THREE.Vector3(x, y, z));
          }
        }
      }

      if (points.length > 1) {
        // Sort points by angle around centroid to avoid cross-connections
        const centroid = points.reduce((acc, p) => acc.add(p.clone()), new THREE.Vector3()).divideScalar(points.length);

        points.sort((a, b) => {
          const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
          const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
          return angleA - angleB;
        });

        const sliceGeometry = new THREE.BufferGeometry().setFromPoints(points.concat(points[0])); // close the loop
        const sliceMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const sliceLine = new THREE.LineLoop(sliceGeometry, sliceMaterial);
        sliceLine.name = "sliceLine";
        scene.add(sliceLine);
      }
    });
  };

  // --- 5. Export Functions ---
  const exportSVG = () => {
    if (!sceneState.scene) return;
    const lines = sceneState.scene.children.filter((child) => child.name === "sliceLine");
    if (lines.length === 0) return alert("No slices to export.");

    let svgPaths = "";
    lines.forEach((line) => {
      const pos = line.geometry.attributes.position;
      let pathD = "";
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i).toFixed(2);
        const y = pos.getY(i).toFixed(2);
        pathD += i === 0 ? `M ${x} ${-y}` : ` L ${x} ${-y}`;
      }
      pathD += " Z"; // close path

      svgPaths += `<path d="${pathD}" stroke="red" stroke-width="0.05" fill="none"/>`;
    });

    const svgContent = `<?xml version="1.0" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1">
${svgPaths}
</svg>`;

    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    saveAs(blob, "slice.svg");
  };

  const exportDXF = () => {
    if (!sceneState.scene) return;
    const lines = sceneState.scene.children.filter((child) => child.name === "sliceLine");
    if (lines.length === 0) return alert("No slices to export.");

    let dxfContent = "0\nSECTION\n2\nENTITIES\n";
    lines.forEach((line) => {
      const pos = line.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x1 = pos.getX(i).toFixed(2);
        const y1 = pos.getY(i).toFixed(2);
        const x2 = pos.getX((i + 1) % pos.count).toFixed(2);
        const y2 = pos.getY((i + 1) % pos.count).toFixed(2);

        dxfContent +=
          `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0\n`;
      }
    });
    dxfContent += "0\nENDSEC\n0\nEOF";

    const blob = new Blob([dxfContent], { type: "application/dxf" });
    saveAs(blob, "slice.dxf");
  };

  // --- UI Render ---
  return (
    <div>
      <div style={{ padding: 10 }}>
        <label>
          Slice Height:
          <input
            type="number"
            step="0.1"
            min="0.1"
            value={slicingParams.sliceHeight}
            onChange={handleSliceHeightChange}
          />
        </label>

        <label style={{ marginLeft: 20 }}>
  <input
    type="checkbox"
    checked={slicingParams.showOnlyCurrentSlice}
    onChange={() =>
      setSlicingParams((prev) => ({
        ...prev,
        showOnlyCurrentSlice: !prev.showOnlyCurrentSlice,
        stepThrough: !prev.showOnlyCurrentSlice, // Enable slider if toggled
      }))
    }
  />
  Show Only Selected Slice
</label>


        <label style={{ marginLeft: 20 }}>
          Plane:
          <select value={slicingParams.slicingPlane} onChange={handlePlaneChange}>
            <option value="Z">Z</option>
            <option value="X">X</option>
            <option value="Y">Y</option>
          </select>
        </label>

        <label style={{ marginLeft: 20 }}>
          Step Through:
          <input
            type="range"
            min={geometry?.boundingBox?.min[slicingParams.slicingPlane.toLowerCase()] || 0}
            max={geometry?.boundingBox?.max[slicingParams.slicingPlane.toLowerCase()] || 100}
            step="0.1"
            value={slicingParams.currentSlice}
            onChange={handleStepChange}
            disabled={!geometry}
          />
        </label>

        <button onClick={exportSVG} style={{ marginLeft: 20 }}>
          Export SVG
        </button>
        <button onClick={exportDXF} style={{ marginLeft: 10 }}>
          Export DXF
        </button>
      </div>
      <div ref={mountRef} style={{ width: "100%", height: "90vh" }} />
    </div>
  );
};

export default STLViewer;
