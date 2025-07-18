import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from 'file-saver';

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

  const exportCurrentSlice = () => {
    const scene = sceneState.scene;
    if (!scene) return;

    const lines = scene.children.filter(child => child.name === "sliceLine");
    if (lines.length === 0) return;

    let dxfContent = "0\nSECTION\n2\nENTITIES\n";
    lines.forEach(line => {
      const pos = line.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 2) {
        const x1 = pos.getX(i).toFixed(2);
        const y1 = pos.getY(i).toFixed(2);
        const x2 = pos.getX(i + 1).toFixed(2);
        const y2 = pos.getY(i + 1).toFixed(2);
        dxfContent += `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0\n`;
      }
    });
    dxfContent += "0\nENDSEC\n0\nEOF";

    const blob = new Blob([dxfContent], { type: "application/dxf" });
    saveAs(blob, "slice.dxf");

    const svgLines = lines.map(line => {
      const pos = line.geometry.attributes.position;
      let pathData = '';
      for (let i = 0; i < pos.count; i += 2) {
        const x1 = pos.getX(i);
        const y1 = pos.getY(i);
        const x2 = pos.getX(i + 1);
        const y2 = pos.getY(i + 1);
        pathData += `<path d=\"M ${x1},${-y1} L ${x2},${-y2}\" stroke=\"black\" fill=\"none\"/>\n`;
      }
      return pathData;
    }).join('');

    const svg = `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\">\n${svgLines}</svg>`;
    const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
    saveAs(svgBlob, 'slice.svg');
  };

  const clearSlices = (scene) => {
    const slices = scene.children.filter(child => child.name === "sliceLine");
    slices.forEach(line => scene.remove(line));
  };

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
        <button onClick={exportCurrentSlice} style={{ marginLeft: 20 }}>
          Export DXF & SVG
        </button>
      </div>
      <div ref={mountRef} style={{ width: "100%", height: "90vh" }} />
    </div>
  );
};

export default STLViewer;
