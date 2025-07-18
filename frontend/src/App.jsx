import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";

export default function App() {
  const mountRef = useRef(null);
  const [renderer, setRenderer] = useState(null);
  const [scene, setScene] = useState(null);
  const [camera, setCamera] = useState(null);

  useEffect(() => {
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 100;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    mountRef.current.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0x404040);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1).normalize();

    scene.add(ambientLight);
    scene.add(directionalLight);

    const animate = function () {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    setScene(scene);
    setCamera(camera);
    setRenderer(renderer);

    return () => {
      mountRef.current.removeChild(renderer.domElement);
    };
  }, []);

  const loadSTL = (file) => {
    const loader = new STLLoader();
    const reader = new FileReader();

    reader.onload = function (e) {
      const contents = e.target.result;
      const geometry = loader.parse(contents);
      const material = new THREE.MeshStandardMaterial({ color: 0x808080 });
      const mesh = new THREE.Mesh(geometry, material);
      geometry.center(); // center the mesh
      scene.add(mesh);
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <input
        type="file"
        accept=".stl"
        onChange={(e) => {
          if (e.target.files[0]) {
            loadSTL(e.target.files[0]);
          }
        }}
        style={{ position: "absolute", zIndex: 1 }}
      />
      <div ref={mountRef} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
