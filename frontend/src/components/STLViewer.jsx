import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from "file-saver";

const STLViewer = () => {
  const mountRef = useRef(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneState, setSceneState] = useState({ scene: null, renderer: null });
  const [geometry, setGeometry] = useState(null);
  const [stlFile, setStlFile] = useState(null);
  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 2,
    showSlices: true,
    currentSlicePos: 0,
    stepThrough: false,
    slicingPlane: "Z"
  });

  // Load STL from user file input
  const handleFileInput = (e) => {
    if (e.target.files.length === 0) return;
    const file = e.target.files[0];
    const url = URL.createObjectURL(file);
    setStlFile(url);
  };

  // Update handlers
  const handleSliceHeightChange = (e) => {
    setSlicingParams({ ...slicingParams, sliceHeight: parseFloat(e.target.value), stepThrough: false });
  };

  const handlePlaneChange = (e) => {
    setSlicingParams({ ...slicingParams, slicingPlane: e.target.value, stepThrough: false });
  };

  const handleToggleSlices = () => {
    setSlicingParams({ ...slicingParams, showSlices: !slicingParams.showSlices });
  };

  const handleStepChange = (e) => {
    setSlicingParams({ ...slicingParams, currentSlicePos: parseFloat(e.target.value), stepThrough: true });
  };

  // Clear previous slices from scene
  const clearSlices = (scene) => {
    scene.children.filter(c => c.name === "sliceLine").forEach(line => scene.remove(line));
  };

  // Slice geometry at given heights on selected plane
  const sliceSTL = (geometry, scene, heightStep = 2, currentVal = null, plane = "Z") => {
    const position = geometry.attributes.position;
    const bbox = geometry.boundingBox;

    let axis, min, max;
    if (plane === "Z") {
      axis = "z"; min = bbox.min.z; max = bbox.max.z;
    } else if (plane === "X") {
      axis = "x"; min = bbox.min.x; max = bbox.max.x;
    } else {
      axis = "y"; min = bbox.min.y; max = bbox.max.y;
    }

    const values = currentVal !== null
      ? [currentVal]
      : Array.from({ length: Math.floor((max - min) / heightStep) + 1 }, (_, i) => min + i * heightStep);

    values.forEach(value => {
      const points = [];

      for (let i = 0; i < position.count; i += 3) {
        const p1 = new THREE.Vector3().fromBufferAttribute(position, i);
        const p2 = new THREE.Vector3().fromBufferAttribute(position, i + 1);
        const p3 = new THREE.Vector3().fromBufferAttribute(position, i + 2);

        const triangle = [p1, p2, p3];
        for (let j = 0; j < 3; j++) {
          const v1 = triangle[j];
          const v2 = triangle[(j + 1) % 3];

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
        const sliceGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const sliceMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const sliceLine = new THREE.LineSegments(sliceGeometry, sliceMaterial);
        sliceLine.name = "sliceLine";
        scene.add(sliceLine);
      }
    });
  };

  // Project 3D points to 2D coords for export
  const projectPoint = (v) => {
    switch (slicingParams.slicingPlane) {
      case "X": return { x: v.y, y: v.z };
      case "Y": return { x: v.x, y: v.z };
      default: return { x: v.x, y: v.y };
    }
  };

  // Export DXF
  const exportDXF = () => {
    const scene = sceneState.scene;
    if (!scene) return;

    const lines = scene.children.filter(c => c.name === "sliceLine");
    if (!lines.length) return alert("No slices to export!");

    let dxf = "0\nSECTION\n2\nENTITIES\n";
    lines.forEach(line => {
      const pos = line.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 2) {
        const p1 = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
        const p2 = new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
        const proj1 = projectPoint(p1);
        const proj2 = projectPoint(p2);

        dxf += `0\nLINE\n8\n0\n10\n${proj1.x.toFixed(3)}\n20\n${proj1.y.toFixed(3)}\n30\n0\n11\n${proj2.x.toFixed(3)}\n21\n${proj2.y.toFixed(3)}\n31\n0\n`;
      }
    });
    dxf += "0\nENDSEC\n0\nEOF";

    const blob = new Blob([dxf], { type: "application/dxf" });
    saveAs(blob, "slice.dxf");
  };

  // Export SVG (red stroke 0.05mm, connected)
  const exportSVG = () => {
    const scene = sceneState.scene;
    if (!scene) return;

    const lines = scene.children.filter(c => c.name === "sliceLine");
    if (!lines.length) return alert("No slices to export!");

    let svgPaths = "";
    lines.forEach(line => {
      const pos = line.geometry.attributes.position;
      if (pos.count < 2) return;

      let firstP = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0));
      let proj = projectPoint(firstP);
      let pathData = `M ${proj.x} ${-proj.y}`;

      for (let i = 1; i < pos.count; i++) {
        const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
        const projP = projectPoint(p);
        pathData += ` L ${projP.x} ${-projP.y}`;
      }

      svgPaths += `<path d="${pathData}" stroke="red" stroke-width="0.05" fill="none"/>`;
    });

    const svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="100%" height="100%" viewBox="-100 -100 200 200">
${svgPaths}
</svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml" });
    saveAs(blob, "slice.svg");
  };

  // Setup three.js scene
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

    setSceneReady(true);
    setSceneState({ scene, renderer });

    return () => {
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // Load STL and update scene + slices on file or slicing param changes
  useEffect(() => {
    if (!sceneReady || !stlFile) return;

    const loader = new STLLoader();
    loader.load(stlFile, (geometry) => {
      geometry.computeBoundingBox();
      setGeometry(geometry);

      const material = new THREE.MeshPhongMaterial({ color: 0x00aaff });
      const mesh = new THREE.Mesh(geometry, material);

      const center = new THREE.Vector3();
      geometry.boundingBox.getCenter(center);
      mesh.position.sub(center);
      mesh.name = "stlMesh";

      const scene = sceneState.scene;
      if (!scene) return;

      const existingMesh = scene.getObjectByName("stlMesh");
      if (existingMesh) scene.remove(existingMesh);
      clearSlices(scene);

      scene.add(mesh);

      if (slicingParams.showSlices) {
        sliceSTL(
          geometry,
          scene,
          slicingParams.sliceHeight,
          slicingParams.stepThrough ? slicingParams.currentSlicePos : null,
          slicingParams.slicingPlane
        );
      }
    });
  }, [stlFile, sceneReady, slicingParams]);

  return (
    <div>
      <div style={{ padding: 10, background: "#222", color: "#eee", fontFamily: "sans-serif", userSelect: "none" }}>
        <input type="file" accept=".stl" onChange={handleFileInput} />

        <label style={{ marginLeft: 20 }}>
          Slice Height (mm):
          <input
            type="number"
            step="0.1"
            min="0.1"
            value={slicingParams.sliceHeight}
            onChange={handleSliceHeightChange}
            style={{ width: 60, marginLeft: 5 }}
          />
        </label>

        <label style={{ marginLeft: 20 }}>
          <input
            type="checkbox"
            checked={slicingParams.showSlices}
            onChange={handleToggleSlices}
          />
          Show Slices
        </label>

        <label style={{ marginLeft: 20 }}>
          Plane:
          <select
            value={slicingParams.slicingPlane}
            onChange={handlePlaneChange}
            style={{ marginLeft: 5 }}
          >
            <option value="Z">Z</option>
            <option value="X">X</option>
            <option value="Y">Y</option>
          </select>
        </label>

        <label style={{ marginLeft: 20 }}>
          Step Through:
          <input
            type="range"
            min={geometry?.boundingBox?.min[slicingParams.slicingPlane.toLowerCase()] ?? 0}
            max={geometry?.boundingBox?.max[slicingParams.slicingPlane.toLowerCase()] ?? 100}
            step="0.1"
            value={slicingParams.currentSlicePos}
            onChange={handleStepChange}
            disabled={!geometry}
            style={{ verticalAlign: "middle", marginLeft: 5, width: 150 }}
          />
        </label>

        <button onClick={exportDXF} style={{ marginLeft: 20 }}>
          Export DXF
        </button>

        <button onClick={exportSVG} style={{ marginLeft: 10 }}>
          Export SVG
        </button>
      </div>

      <div ref={mountRef} style={{ width: "100%", height: "90vh" }} />
    </div>
  );
};

export default STLViewer;
