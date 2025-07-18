import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from "file-saver";

const STLViewer = () => {
  const mountRef = useRef(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneState, setSceneState] = useState({ scene: null, renderer: null, camera: null });
  const [geometry, setGeometry] = useState(null);
  const [stlFile, setStlFile] = useState(null);
  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 2,
    showSlices: true,
    currentSlicePos: 0,
    stepThrough: false,
    slicingPlane: "Z",
  });

  // Load a default mid-sized model URL (example)
  const defaultModelURL = "https://raw.githubusercontent.com/ishouldhaveneverdonethat/Slicr/main/models/sample.stl";

  const loadSTLFromURL = (url) => {
    setStlFile(url);
  };

  // Handle file upload input change
  const handleFileUpload = (e) => {
    if (e.target.files.length === 0) return;
    const file = e.target.files[0];
    const url = URL.createObjectURL(file);
    setStlFile(url);
  };

  const handleSliceHeightChange = (e) => {
    setSlicingParams({ ...slicingParams, sliceHeight: parseFloat(e.target.value), stepThrough: false });
  };

  const handlePlaneChange = (e) => {
    setSlicingParams({ ...slicingParams, slicingPlane: e.target.value, stepThrough: false, currentSlicePos: 0 });
  };

  const handleToggleSlices = () => {
    setSlicingParams({ ...slicingParams, showSlices: !slicingParams.showSlices });
  };

  const handleStepChange = (e) => {
    setSlicingParams({ ...slicingParams, currentSlicePos: parseFloat(e.target.value), stepThrough: true });
  };

  // Clear previous slices
  const clearSlices = (scene) => {
    const slices = scene.children.filter((child) => child.name === "sliceLine");
    slices.forEach((line) => scene.remove(line));
  };

  // Slice STL geometry at specified plane and height(s)
  const sliceSTL = (geometry, scene, heightStep = 2, currentPos = null, plane = "Z") => {
    const position = geometry.attributes.position;
    geometry.computeBoundingBox();
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

    const slicePositions =
      currentPos !== null ? [currentPos] : Array.from({ length: Math.floor((max - min) / heightStep) + 1 }, (_, i) => min + i * heightStep);

    slicePositions.forEach((value) => {
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

  // Export slice data in DXF or SVG with correct axis mapping
  const exportSlices = (format) => {
    const scene = sceneState.scene;
    if (!scene) return;

    const lines = scene.children.filter((child) => child.name === "sliceLine");
    if (lines.length === 0) return;

    function projectPoint(v) {
      const plane = slicingParams.slicingPlane;
      if (plane === "Z") return { x: v.x, y: v.y };
      if (plane === "X") return { x: v.y, y: v.z };
      if (plane === "Y") return { x: v.x, y: v.z };
      return { x: v.x, y: v.y };
    }

    if (format === "dxf") {
      let dxfContent = "0\nSECTION\n2\nENTITIES\n";
      lines.forEach((line) => {
        const pos = line.geometry.attributes.position;
        for (let i = 0; i < pos.count; i += 2) {
          const p1 = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ ? pos.getZ(i) : 0);
          const p2 = new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ ? pos.getZ(i + 1) : 0);
          const pt1 = projectPoint(p1);
          const pt2 = projectPoint(p2);

          dxfContent +=
            `0\nLINE\n8\n0\n10\n${pt1.x.toFixed(2)}\n20\n${pt1.y.toFixed(2)}\n30\n0\n` +
            `11\n${pt2.x.toFixed(2)}\n21\n${pt2.y.toFixed(2)}\n31\n0\n`;
        }
      });
      dxfContent += "0\nENDSEC\n0\nEOF";

      const blob = new Blob([dxfContent], { type: "application/dxf" });
      saveAs(blob, "slice.dxf");
    } else if (format === "svg") {
      const svgLines = lines
        .map((line) => {
          const pos = line.geometry.attributes.position;
          let pathData = "";
          for (let i = 0; i < pos.count; i += 2) {
            const p1 = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ ? pos.getZ(i) : 0);
            const p2 = new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ ? pos.getZ(i + 1) : 0);
            const pt1 = projectPoint(p1);
            const pt2 = projectPoint(p2);
            pathData += `<path d="M ${pt1.x},${-pt1.y} L ${pt2.x},${-pt2.y}" stroke="red" stroke-width="0.05" fill="none"/>\n`;
          }
          return pathData;
        })
        .join("");

      const svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1">
${svgLines}
</svg>`;
      const svgBlob = new Blob([svg], { type: "image/svg+xml" });
      saveAs(svgBlob, "slice.svg");
    }
  };

  // Initialize scene, camera, renderer, controls
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
    setSceneState({ scene, renderer, camera });

    return () => {
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // Load and render STL + slices on param changes
  useEffect(() => {
    if (!sceneReady || !stlFile) return;

    const loader = new STLLoader();
    loader.load(
      stlFile,
      (geom) => {
        geom.computeBoundingBox();
        setGeometry(geom);

        const material = new THREE.MeshPhongMaterial({ color: 0x00aaff });
        const mesh = new THREE.Mesh(geom, material);

        const center = new THREE.Vector3();
        geom.boundingBox.getCenter(center);
        mesh.position.sub(center);
        mesh.name = "stlMesh";

        const scene = sceneState.scene;
        if (!scene) return;

        // Remove old mesh and add new
        const existing = scene.getObjectByName("stlMesh");
        if (existing) scene.remove(existing);
        scene.add(mesh);

        clearSlices(scene);
        if (slicingParams.showSlices) {
          sliceSTL(geom, scene, slicingParams.sliceHeight, slicingParams.stepThrough ? slicingParams.currentSlicePos : null, slicingParams.slicingPlane);
        }
      },
      undefined,
      (error) => {
        console.error("Error loading STL:", error);
      }
    );
  }, [stlFile, sceneReady, slicingParams, sceneState.scene]);

  return (
    <div>
      <div style={{ padding: 10 }}>
        <input type="file" accept=".stl" onChange={handleFileUpload} />
        <button onClick={() => loadSTLFromURL(defaultModelURL)} style={{ marginLeft: 10 }}>
          Load Default Mid-Sized Model
        </button>

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
          <select value={slicingParams.slicingPlane} onChange={handlePlaneChange} style={{ marginLeft: 5 }}>
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
            disabled={!geometry || !slicingParams.showSlices}
            style={{ verticalAlign: "middle", marginLeft: 5 }}
          />
        </label>

        <button onClick={() => exportSlices("dxf")} style={{ marginLeft: 20 }}>
          Export DXF
        </button>
        <button onClick={() => exportSlices("svg")} style={{ marginLeft: 10 }}>
          Export SVG
        </button>
      </div>

      <div ref={mountRef} style={{ width: "100%", height: "90vh" }} />
    </div>
  );
};

export default STLViewer;
