import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";

const STLViewer = ({ stlFile }) => {
  const mountRef = useRef(null);
  const sceneRef = useRef();
  const cameraRef = useRef();
  const rendererRef = useRef();
  const controlsRef = useRef();
  const meshRef = useRef();

  useEffect(() => {
    const mount = mountRef.current;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121212);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      75,
      mount.clientWidth / mount.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 100);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 50, 100).normalize();
    scene.add(ambientLight);
    scene.add(directionalLight);

    // Animate
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    if (!stlFile || !sceneRef.current) return;

    const loader = new STLLoader();
    loader.load(stlFile, (geometry) => {
      const material = new THREE.MeshPhongMaterial({ color: 0x00aaff });
      const mesh = new THREE.Mesh(geometry, material);

      geometry.computeBoundingBox();
      const center = new THREE.Vector3();
      geometry.boundingBox.getCenter(center);
      mesh.position.sub(center); // center the mesh

      // Remove old mesh if exists
      if (meshRef.current) {
        sceneRef.current.remove(meshRef.current);
      }

      sceneRef.current.add(mesh);
      meshRef.current = mesh;
    });
  }, [stlFile]);

  return <div ref={mountRef} style={{ width: "100%", height: "100vh" }} />;
};

export default STLViewer;
