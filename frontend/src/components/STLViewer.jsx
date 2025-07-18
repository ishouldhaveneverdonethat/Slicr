// File: src/components/STLViewer.jsx

import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";

const STLViewer = ({ stlFile }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);

  useEffect(() => {
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambient = new THREE.AmbientLight(0x404040, 2);
    const directional = new THREE.DirectionalLight(0xffffff, 1);
    directional.position.set(0, 1, 1).normalize();
    scene.add(ambient);
    scene.add(directional);

    // Controls STL
    if (stlFile) {
      const loader = new STLLoader();
      loader.load(
        stlFile,
        (geometry) => {
          const material = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
          const mesh = new THREE.Mesh(geometry, material);

          geometry.computeBoundingBox();
          const center = new THREE.Vector3();
          geometry.boundingBox.getCenter(center);
          mesh.position.sub(center); // Center it

          scene.add(mesh);
        },
        undefined,
        (error) => console.error("STL loading error:", error)
      );
    }

    // Animate
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      mountRef.current.removeChild(renderer.domElement);
    };
  }, [stlFile]);

  return <div ref={mountRef} style={{ width: "100%", height: "100vh" }} />;
};

export default STLViewer;
