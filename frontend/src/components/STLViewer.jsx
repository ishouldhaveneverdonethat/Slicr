import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from "file-saver";

const STLViewer = ({ stlFile }) => {
  const mountRef = useRef(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneState, setSceneState] = useState({ scene: null, renderer: null });
  const [geometry, setGeometry] = useState(null);
  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 2,
    showSlices: true,
    currentSliceZ: 0,
    stepThrough: false,
    slicingPlane: "Z"
  });

  const handleSliceHeightChange = (e) => {
    setSlicingParams({ ...slicingParams, sliceHeight: parseFloat(e.target.value) });
  };

  const handlePlaneChange = (e) => {
    setSlicingParams({ ...slicingParams, slicingPlane: e.target.value });
  };

  const handleToggleSlices = () => {
    setSlicingParams({ ...slicingParams, showSlices: !slicingParams.showSlices });
  };

  const handleStepChange = (e) => {
    setSlicingParams({ ...slicingParams, currentSliceZ: parseFloat(e.target.value), stepThrough: true });
  };

  // Helper to compare points with tolerance
  const pointsEqual = (p1, p2, eps = 1e-5) => {
    return p1.distanceToSquared(p2) < eps * eps;
  };

  // Chain line segments into connected polylines
  const buildPolylines = (segments) => {
    const polylines = [];

    while (segments.length) {
      let polyline = segments.pop();
      let changed;

      do {
        changed = false;
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];

          if (pointsEqual(polyline[polyline.length - 1], seg[0])) {
            polyline.push(seg[1]);
            segments.splice(i, 1);
            changed = true;
            break;
          } else if (pointsEqual(polyline[polyline.length - 1], seg[1])) {
            polyline.push(seg[0]);
            segments.splice(i, 1);
            changed = true;
            break;
          } else if (pointsEqual(polyline[0], seg[0])) {
            polyline.unshift(seg[1]);
            segments.splice(i, 1);
            changed = true;
            break;
          } else if (pointsEqual(polyline[0], seg[1])) {
            polyline.unshift(seg[0]);
            segments.splice(i, 1);
            changed = true;
            break;
          }
        }
      } while (changed);

      polylines.push(polyline);
    }

    return polylines;
  };

  // Main slicing function
  const sliceSTL = (geometry, scene, heightStep = 2, currentZ = null, plane = "Z") => {
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

    const values = currentZ !== null ? [currentZ] : Array.from({ length: Math.floor((max - min) / heightStep) + 1 }, (_, i) => min + i * heightStep);

    values.forEach(value => {
      const segments = [];

      for (let i = 0; i < position.count; i += 3) {
        const p1 = new THREE.Vector3().fromBufferAttribute(position, i);
        const p2 = new THREE.Vector3().fromBufferAttribute(position, i + 1);
        const p3 = new THREE.Vector3().fromBufferAttribute(position, i + 2);

        const triangle = [p1, p2, p3];

        let intersections = [];

        for (let j = 0; j < 3; j++) {
          const v1 = triangle[j];
          const v2 = triangle[(j + 1) % 3];

          if ((v1[axis] <= value && v2[axis] >= value) || (v2[axis] <= value && v1[axis] >= value)) {
            const t = (value - v1[axis]) / (v2[axis] - v1[axis]);
            const x = v1.x + t * (v2.x - v1.x);
            const y = v1.y + t * (v2.y - v1.y);
            const z = v1.z + t * (v2.z - v1.z);
            intersections.push(new THREE.Vector3(x, y, z));
          }
        }

        if (intersections.length === 2) {
          segments.push([intersections[0], intersections[1]]);
        }
      }

      // Clear existing slice lines first
      clearSlices(scene);

      // Build connected polylines from segments
      const polylines = buildPolylines(segments);

      // Add polylines to scene as continuous lines
      polylines.forEach(polyline => {
        if (polyline.length < 2) return;
        const sliceGeometry = new THREE.BufferGeometry().setFromPoints(polyline);
        const sliceMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const sliceLine = new THREE.Line(sliceGeometry, sliceMaterial);
        sliceLine.name = "sliceLine";
        scene.add(sliceLine);
      });
    });
  };

  const clearSlices = (scene) => {
    const slices = scene.children.filter(child => child.name === "sliceLine");
    slices.forEach(line => scene.remove(line));
  };

  // Export connected polylines to DXF
  const exportDXF = () => {
    const scene = sceneState.scene;
    if (!scene) return;

    const lines = scene.children.filter(child => child.name === "sliceLine");
    if (lines.length === 0) return;

    let dxfContent = "0\nSECTION\n2\nENTITIES\n";

    lines.forEach(line => {
      const positions = line.geometry.attributes.position;
      for (let i = 0; i < positions.count - 1; i++) {
        const x1 = positions.getX(i).toFixed(3);
        const y1 = positions.getY(i).toFixed(3);
        const x2 = positions.getX(i + 1).toFixed(3);
        const y2 = positions.getY(i + 1).toFixed(3);
        dxfContent +=
          `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0\n`;
      }
    });

    dxfContent += "0\nENDSEC\n0\nEOF";

    const blob = new Blob([dxfContent], { type: "application/dxf" });
    saveAs(blob, "slice.dxf");
  };

  // Export connected polylines to SVG with red stroke 0.05mm
  const exportSVG = () => {
    const scene = sceneState.scene;
    if (!scene) return;

    const lines = scene.children.filter(child => child.name === "sliceLine");
    if (lines.length === 0) return;

    const svgPaths = lines.map(line => {
      const pos = line.geometry.attributes.position;
      let pathData = "M ";
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i).toFixed(3);
        const y = -pos.getY(i).toFixed(3); // invert Y for SVG coords
        pathData += `${x},${y} `;
      }
      return `<path d="${pathData}" stroke="red" stroke-width="0.05" fill="none"/>`;
    }).join('\n');

    const svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1">
${svgPaths}
</svg>`;

    const svgBlob = new Blob([svgContent], { type: 'image/svg+xml' });
    saveAs(svgBlob, 'slice.svg');
  };

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

      const existing = scene.getObjectByName("stlMesh");
      if (existing) scene.remove(existing);
      scene.add(mesh);

      clearSlices(scene);
      if (slicingParams.showSlices) {
        sliceSTL(geometry, scene, slicingParams.sliceHeight, slicingParams.stepThrough ? slicingParams.currentSliceZ : null, slicingParams.slicingPlane);
      }
    });
  }, [stlFile, sceneReady, slicingParams]);

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
            checked={slicingParams.showSlices}
            onChange={handleToggleSlices}
          />
          Show Slices
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
            value={slicingParams.currentSliceZ}
            onChange={handleStepChange}
            disabled={!geometry}
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
