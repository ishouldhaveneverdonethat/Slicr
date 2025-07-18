import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";

const STLViewer = ({ stlFile }) => {
  const mountRef = useRef(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneState, setSceneState] = useState({ scene: null, renderer: null });
  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 2,
    showSlices: true
  });

  const handleSliceHeightChange = (e) => {
    setSlicingParams({ ...slicingParams, sliceHeight: parseFloat(e.target.value) });
  };

  const handleToggleSlices = () => {
    setSlicingParams({ ...slicingParams, showSlices: !slicingParams.showSlices });
  };

  const clearSlices = (scene) => {
    const slices = scene.children.filter(child => child.name === "sliceLine");
    slices.forEach(line => scene.remove(line));
  };

  const sliceSTL = (geometry, scene, heightStep = 2) => {
    const position = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    const segments = new Set();

    for (let z = geometry.boundingBox.min.z; z <= geometry.boundingBox.max.z; z += heightStep) {
      const points = [];

      for (let i = 0; i < position.count; i += 3) {
        const p1 = new THREE.Vector3().fromBufferAttribute(position, i);
        const p2 = new THREE.Vector3().fromBufferAttribute(position, i + 1);
        const p3 = new THREE.Vector3().fromBufferAttribute(position, i + 2);

        const triangle = [p1, p2, p3];
        for (let j = 0; j < 3; j++) {
          const v1 = triangle[j];
          const v2 = triangle[(j + 1) % 3];

          if ((v1.z <= z && v2.z >= z) || (v2.z <= z && v1.z >= z)) {
            const t = (z - v1.z) / (v2.z - v1.z);
            const x = v1.x + t * (v2.x - v1.x);
            const y = v1.y + t * (v2.y - v1.y);
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
    }
  };

  useEffect(() => {
    const mount = mountRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121212);

    const camera = new THREE.PerspectiveCamera(
      75,
      mount.clientWidth / mount.clientHeight,
      0.1,
      1000
    );
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
        sliceSTL(geometry, scene, slicingParams.sliceHeight);
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
      </div>
      <div ref={mountRef} style={{ width: "100%", height: "90vh" }} />
    </div>
  );
};

export default STLViewer;
