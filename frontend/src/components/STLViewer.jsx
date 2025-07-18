import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from "file-saver";

const STLViewer = ({ stlFile }) => {
  const mountRef = useRef(null);
  const [sceneState, setSceneState] = useState({ scene: null, renderer: null });
  const [geometry, setGeometry] = useState(null);

  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 2,
    showSlices: true,
    currentSlice: 0,
    stepThrough: false,
    slicingPlane: "Z",
  });

  // Update slicing params handlers
  const handleSliceHeightChange = (e) =>
    setSlicingParams((p) => ({ ...p, sliceHeight: parseFloat(e.target.value) }));

  const handleToggleSlices = () =>
    setSlicingParams((p) => ({ ...p, showSlices: !p.showSlices }));

  const handlePlaneChange = (e) =>
    setSlicingParams((p) => ({
      ...p,
      slicingPlane: e.target.value,
      currentSlice: geometry
        ? geometry.boundingBox.min[e.target.value.toLowerCase()]
        : 0,
    }));

  const handleStepChange = (e) =>
    setSlicingParams((p) => ({
      ...p,
      currentSlice: parseFloat(e.target.value),
      stepThrough: true,
    }));

  // Clear all slice lines
  const clearSlices = (scene) => {
    scene.children
      .filter((child) => child.name === "sliceLine")
      .forEach((line) => scene.remove(line));
  };

  // Project 3D points to 2D coords for export based on slicing plane
  const projectPoint = (vec3, plane) => {
    switch (plane) {
      case "X":
        return { x: vec3.y, y: vec3.z };
      case "Y":
        return { x: vec3.x, y: vec3.z };
      case "Z":
      default:
        return { x: vec3.x, y: vec3.y };
    }
  };

  // Slice STL geometry by plane and heightStep, optionally single slice at currentSlice
  const sliceSTL = (geometry, scene, heightStep, currentSlice, plane) => {
    const pos = geometry.attributes.position;
    const bbox = geometry.boundingBox;

    let axis, min, max;
    switch (plane) {
      case "X":
        axis = "x";
        min = bbox.min.x;
        max = bbox.max.x;
        break;
      case "Y":
        axis = "y";
        min = bbox.min.y;
        max = bbox.max.y;
        break;
      case "Z":
      default:
        axis = "z";
        min = bbox.min.z;
        max = bbox.max.z;
    }

    const sliceValues =
      currentSlice !== null ? [currentSlice] : Array.from(
        { length: Math.floor((max - min) / heightStep) + 1 },
        (_, i) => min + i * heightStep
      );

    sliceValues.forEach((value) => {
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
        const sliceGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const sliceMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const sliceLine = new THREE.LineSegments(sliceGeometry, sliceMaterial);
        sliceLine.name = "sliceLine";
        scene.add(sliceLine);
      }
    });
  };

  // Export slice lines as DXF with correct 2D projection
  const exportDXF = () => {
    const scene = sceneState.scene;
    if (!scene) return;
    const lines = scene.children.filter((child) => child.name === "sliceLine");
    if (!lines.length) return;

    let dxfContent = "0\nSECTION\n2\nENTITIES\n";

    lines.forEach((line) => {
      const pos = line.geometry.attributes.position;
      for (let i = 0; i < pos.count - 1; i++) {
        const p1 = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
        const p2 = new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));

        const proj1 = projectPoint(p1, slicingParams.slicingPlane);
        const proj2 = projectPoint(p2, slicingParams.slicingPlane);

        dxfContent +=
          `0\nLINE\n8\n0\n10\n${proj1.x.toFixed(3)}\n20\n${proj1.y.toFixed(3)}\n30\n0\n` +
          `11\n${proj2.x.toFixed(3)}\n21\n${proj2.y.toFixed(3)}\n31\n0\n`;
      }
    });

    dxfContent += "0\nENDSEC\n0\nEOF";

    const blob = new Blob([dxfContent], { type: "application/dxf" });
    saveAs(blob, "slice.dxf");
  };

  // Export slice lines as SVG with correct 2D projection and stroke 0.05mm red
  const exportSVG = () => {
    const scene = sceneState.scene;
    if (!scene) return;
    const lines = scene.children.filter((child) => child.name === "sliceLine");
    if (!lines.length) return;

    const svgPaths = lines
      .map((line) => {
        const pos = line.geometry.attributes.position;
        let pathData = "M ";
        for (let i = 0; i < pos.count; i++) {
          const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
          const proj = projectPoint(p, slicingParams.slicingPlane);
          pathData += `${proj.x.toFixed(3)},${-proj.y.toFixed(3)} `;
        }
        return `<path d="${pathData}" stroke="red" stroke-width="0.05" fill="none"/>`;
      })
      .join("\n");

    const svgContent = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1">
${svgPaths}
</svg>`;

    const svgBlob = new Blob([svgContent], { type: "image/svg+xml" });
    saveAs(svgBlob, "slice.svg");
  };

  // Initialize ThreeJS scene
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
    renderer.setSize(mount
