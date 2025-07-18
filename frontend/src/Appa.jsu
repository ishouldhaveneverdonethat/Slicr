import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";

function App() {
  const mountRef = useRef(null);
  const [scene, setScene] = useState(null);
  const [renderer, setRenderer] = useState(null);
  const [camera, setCamera] = useState(null);

  useEffect(() => {
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    mountRef.current.appendChild(renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(1, 2, 3);
    scene.add(light);

    setScene(scene);
    setCamera(camera);
    setRenderer(renderer);

    const animate = function () {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      mountRef.current.removeChild(renderer.domElement);
    };
  }, []);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file || !scene) return;

    const reader = new FileReader();
    reader.onload = function (event) {
      const contents = event.target.result;
      const loader = new STLLoader();
      const geometry = loader.parse(contents);

      const material = new THREE.MeshStandardMaterial({ color: 0x0077ff });
      const mesh = new THREE.Mesh(geometry, material);

      scene.clear(); // remove old mesh
      scene.add(mesh);
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <div style={{ padding: "1rem" }}>
      <h1>Slicr MVP</h1>
      <input type="file" accept=".stl" onChange={handleFile} />
      <div
        ref={mountRef}
        style={{ width: "100%", height: "500px", border: "1px solid #ccc", marginTop: "1rem" }}
      />
    </div>
  );
}

export default App;
