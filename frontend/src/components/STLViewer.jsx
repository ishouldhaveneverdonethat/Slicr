import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from "file-saver";

// Correct way to import a Web Worker in modern bundlers (like Create React App v5+)
const SlicerWorker = new Worker(new URL('../workers/slicerWorker.js', import.meta.url));


const STLViewer = ({ stlFile }) => {
  // --- Refs for Three.js objects to maintain single instances ---
  const mountRef = useRef(null); // Ref for the main viewer DOM element
  const miniViewerMountRef = useRef(null); // Ref for the mini-viewer DOM element
  
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);

  const miniSceneRef = useRef(null);
  const miniRendererRef = useRef(null);
  const miniCameraRef = useRef(null);

  // --- React State for UI and Slicing Logic ---
  const [geometry, setGeometry] = useState(null);
  const [originalDimensions, setOriginalDimensions] = useState({ x: 0, y: 0, z: 0 });
  const [targetDimensions, setTargetDimensions] = useState({ width: 0, height: 0, depth: 0 });
  const [currentScale, setCurrentScale] = useState({ x: 1, y: 1, z: 1 }); // Actual scale applied

  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 2,
    showSlices: true,
    currentLayerIndex: 0,
    currentSliceValue: 0,
    singleSliceMode: false,
    slicingPlane: "Z",
  });

  const [showModelOutline, setShowModelOutline] = useState(true);
  const [showMiddleSlice, setShowMiddleSlice] = useState(false);
  const [showMiniViewer, setShowMiniViewer] = useState(false);

  const [debouncedSlicingParams, setDebouncedSlicingParams] = useState(slicingParams);
  const workerInstanceRef = useRef(null);

  // --- Web Worker Initialization and Message Handling ---
  useEffect(() => {
    workerInstanceRef.current = SlicerWorker;

    workerInstanceRef.current.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'slicingComplete' && sceneRef.current) { // Ensure sceneRef.current is available
        clearSlices(sceneRef.current);
        
        payload.forEach(sliceData => {
          const { contours, isFallback } = sliceData;
          if (contours.length === 0) return;

          const materialColor = isFallback ? 0x00ff00 : 0xff0000;
          const sliceMaterial = new THREE.LineBasicMaterial({ color: materialColor });
          const sliceGeometry = new THREE.BufferGeometry();
          sliceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(contours), 3));

          let sliceLine;
          if (isFallback) {
            sliceLine = new THREE.LineSegments(sliceGeometry, sliceMaterial);
          } else {
            const positions = sliceGeometry.attributes.position.array;
            const firstPointX = positions[0];
            const firstPointY = positions[1];
            const firstPointZ = positions[2];
            const lastPointX = positions[positions.length - 3];
            const lastPointY = positions[positions.length - 2];
            const lastPointZ = positions[positions.length - 1];

            const arePointsIdentical = Math.abs(firstPointX - lastPointX) < 1e-6 &&
                                       Math.abs(firstPointY - lastPointY) < 1e-6 &&
                                       Math.abs(firstPointZ - lastPointZ) < 1e-6;

            if (!arePointsIdentical) {
                const closedPositions = new Float32Array(positions.length + 3);
                closedPositions.set(positions);
                closedPositions.set([firstPointX, firstPointY, firstPointZ], positions.length);
                sliceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(closedPositions, 3));
            }
            sliceLine = new THREE.LineLoop(sliceGeometry, sliceMaterial);
          }
          
          sliceLine.name = "sliceLine";
          sceneRef.current.add(sliceLine); // Add slices to the main scene
        });
      }
    };
  }, []);

  // --- Debounce for Slicing Parameters ---
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSlicingParams(slicingParams);
    }, 200);
    return () => clearTimeout(handler);
  }, [slicingParams]);


  // --- UI Controls Handlers (Wrapped in useCallback) ---
  const handleSliceHeightChange = useCallback((e) => {
    setSlicingParams((p) => ({
      ...p,
      sliceHeight: parseFloat(e.target.value),
      singleSliceMode: false,
      currentLayerIndex: 0, // Reset layer index when height changes
    }));
    setShowMiddleSlice(false); // Disable middle slice when height changes
  }, []);

  const handlePlaneChange = useCallback((e) => {
    setSlicingParams((p) => ({
      ...p,
      slicingPlane: e.target.value,
      singleSliceMode: false,
      currentLayerIndex: 0, // Reset layer index when plane changes
    }));
    setShowMiddleSlice(false); // Disable middle slice when plane changes
  }, []);

  const handleToggleSlices = useCallback(() => {
    setSlicingParams((p) => ({ ...p, showSlices: !p.showSlices }));
  }, []);

  const handleStepChange = useCallback((e) => {
    // Defensive check: ensure geometry and currentScale are ready before calculations
    if (!geometry || currentScale.x === 0 || currentScale.y === 0 || currentScale.z === 0) {
      return; // Prevent calculations if essential data is not ready
    }

    const newLayerIndex = parseInt(e.target.value, 10);
    // Pass explicit values to getScaledMinRangeValue to ensure freshness
    const calculatedSliceValue = getScaledMinRangeValue(geometry, slicingParams.slicingPlane, currentScale.x, currentScale.y, currentScale.z) + newLayerIndex * slicingParams.sliceHeight;

    setSlicingParams((p) => ({
      ...p,
      currentLayerIndex: newLayerIndex,
      currentSliceValue: calculatedSliceValue,
      singleSliceMode: true,
      showSlices: true,
    }));
    setShowMiddleSlice(false);
  }, [geometry, slicingParams.sliceHeight, slicingParams.slicingPlane, currentScale, getScaledMinRangeValue, setShowMiddleSlice]); // Explicitly list all dependencies

  const handleToggleSingleSliceMode = useCallback(() => {
    setSlicingParams((p) => ({
      ...p,
      singleSliceMode: !p.singleSliceMode,
    }));
    setShowMiddleSlice(false); // Disable middle slice when toggling single slice mode
  }, []);

  const handleToggleModelOutline = useCallback(() => {
    setShowModelOutline(prev => !prev);
  }, []);

  const handleToggleMiddleSlice = useCallback(() => {
    setShowMiddleSlice(prev => !prev);
    setSlicingParams(prev => ({
      ...prev,
      singleSliceMode: false,
      showSlices: true,
    }));
  }, []);

  const handleToggleMiniViewer = useCallback(() => {
    setShowMiniViewer(prev => !prev);
  }, []);

  const handleTargetDimensionChange = useCallback((dimension) => (e) => {
    const inputValue = parseFloat(e.target.value);
    if (isNaN(inputValue) || inputValue <= 0) {
      return;
    }

    if (originalDimensions.x === 0 || originalDimensions.y === 0 || originalDimensions.z === 0) {
        setTargetDimensions(prev => ({
            ...prev,
            [dimension]: inputValue
        }));
        return;
    }

    let scaleFactor = 1;
    if (dimension === 'width') {
      scaleFactor = inputValue / originalDimensions.x;
    } else if (dimension === 'height') {
      scaleFactor = inputValue / originalDimensions.y;
    } else if (dimension === 'depth') {
      scaleFactor = inputValue / originalDimensions.z;
    }

    const newTargetWidth = originalDimensions.x * scaleFactor;
    const newTargetHeight = originalDimensions.y * scaleFactor;
    const newTargetDepth = originalDimensions.z * scaleFactor;

    setTargetDimensions({
      width: newTargetWidth,
      height: newTargetHeight,
      depth: newTargetDepth,
    });
  }, [originalDimensions]); // Dependencies for useCallback


  // --- Three.js Scene Initialization (Runs only once) ---
  useEffect(() => {
    const mount = mountRef.current;
    const miniViewerMount = miniViewerMountRef.current;
    if (!mount || !miniViewerMount) return;

    // Clear any existing canvas elements to prevent multiple contexts
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    while (miniViewerMount.firstChild) miniViewerMount.removeChild(miniViewerMount.firstChild);

    // Main Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 50, 100).normalize();
    scene.add(directionalLight);

    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    controlsRef.current = controls;

    // Mini-Viewer Scene Setup
    const miniScene = new THREE.Scene();
    miniScene.background = new THREE.Color(0x333333);
    const miniCamera = new THREE.PerspectiveCamera(75, miniViewerMount.clientWidth / miniViewerMount.clientHeight, 0.1, 1000);
    miniCamera.position.set(0, 0, 100);
    miniScene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const miniDirectionalLight = new THREE.DirectionalLight(0xffffff, 0.8); // Independent light for mini-viewer
    miniDirectionalLight.position.set(50, 50, 100).normalize();
    miniScene.add(miniDirectionalLight);
    const miniRenderer = new THREE.WebGLRenderer({ antialias: true });
    miniRenderer.setPixelRatio(window.devicePixelRatio);
    miniRenderer.setSize(miniViewerMount.clientWidth, miniViewerMount.clientHeight);
    miniViewerMount.appendChild(miniRenderer.domElement);

    miniSceneRef.current = miniScene;
    miniRendererRef.current = miniRenderer;
    miniCameraRef.current = miniCamera;

    // Resize Handler
    const handleResize = () => {
      if (cameraRef.current && rendererRef.current && mountRef.current) {
        cameraRef.current.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      }
      if (miniCameraRef.current && miniRendererRef.current && miniViewerMountRef.current) {
        miniCameraRef.current.aspect = miniViewerMountRef.current.clientWidth / miniViewerMountRef.current.clientHeight;
        miniCameraRef.current.updateProjectionMatrix();
        miniRendererRef.current.setSize(miniViewerMountRef.current.clientWidth, miniViewerMountRef.current.clientHeight);
      }
    };
    window.addEventListener("resize", handleResize, { passive: true });

    // Animation Loop (single loop for both renderers)
    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (controlsRef.current) controlsRef.current.update();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }

      // Synchronize mini-viewer camera with main camera
      if (showMiniViewer && miniRendererRef.current && miniSceneRef.current && miniCameraRef.current && cameraRef.current && controlsRef.current) {
        miniCameraRef.current.position.copy(cameraRef.current.position);
        miniCameraRef.current.quaternion.copy(cameraRef.current.quaternion);
        miniCameraRef.current.lookAt(controlsRef.current.target); // Ensure mini-viewer looks at the same target
        miniRendererRef.current.render(miniSceneRef.current, miniCameraRef.current);
      }
    };
    animate();

    // Cleanup function for useEffect
    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
      if (controlsRef.current) controlsRef.current.dispose();
      if (rendererRef.current) rendererRef.current.dispose();
      if (miniRendererRef.current) miniRendererRef.current.dispose();
    };
  }, []); // Empty dependency array ensures this runs only once


  // --- STL File Loading and Mesh Creation ---
  useEffect(() => {
    if (!sceneRef.current || !stlFile) return;

    const loader = new STLLoader();
    loader.load(stlFile, (loadedGeometry) => {
      loadedGeometry.computeBoundingBox();
      setGeometry(loadedGeometry);

      const initialSize = new THREE.Vector3();
      loadedGeometry.boundingBox.getSize(initialSize);
      setOriginalDimensions({ x: initialSize.x, y: initialSize.y, z: initialSize.z });
      setTargetDimensions({ width: initialSize.x, height: initialSize.y, depth: initialSize.z });

      const material = new THREE.MeshPhongMaterial({ color: 0x00aaff, transparent: false, opacity: 1 });
      const mesh = new THREE.Mesh(loadedGeometry, material);
      const center = new THREE.Vector3();
      loadedGeometry.boundingBox.getCenter(center);
      mesh.position.sub(center);
      mesh.name = "stlMesh";

      // Remove previous mesh and outline from main scene
      const existingMesh = sceneRef.current.getObjectByName("stlMesh");
      if (existingMesh) {
        sceneRef.current.remove(existingMesh);
        existingMesh.geometry.dispose();
        existingMesh.material.dispose();
      }
      const existingOutline = sceneRef.current.getObjectByName("modelOutline");
      if (existingOutline) {
        sceneRef.current.remove(existingOutline);
        existingOutline.geometry.dispose();
        existingOutline.material.dispose();
      }
      sceneRef.current.add(mesh);

      const edges = new THREE.EdgesGeometry(loadedGeometry, 30);
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: 0x000000, linewidth: 2, transparent: true, opacity: 0.8, depthTest: true, depthWrite: false
      });
      const modelOutlines = new THREE.LineSegments(edges, outlineMaterial);
      modelOutlines.name = "modelOutline";
      sceneRef.current.add(modelOutlines);

      // Add/update mesh in mini-viewer
      if (miniSceneRef.current) {
        const miniMesh = mesh.clone();
        miniMesh.name = "miniStlMesh";
        const existingMiniMesh = miniSceneRef.current.getObjectByName("miniStlMesh");
        if (existingMiniMesh) {
          miniSceneRef.current.remove(existingMiniMesh);
          existingMiniMesh.geometry.dispose();
          existingMiniMesh.material.dispose();
        }
        miniSceneRef.current.add(miniMesh);

        if (miniCameraRef.current) {
          const size = new THREE.Vector3();
          loadedGeometry.boundingBox.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);
          const fov = miniCameraRef.current.fov * (Math.PI / 180);
          let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
          cameraZ *= 1.5;
          miniCameraRef.current.position.set(center.x, center.y, center.z + cameraZ);
          miniCameraRef.current.lookAt(center);
        }
      }

      // Initial camera positioning for main viewer
      if (cameraRef.current && controlsRef.current) {
        const size = new THREE.Vector3();
        loadedGeometry.boundingBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = cameraRef.current.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5;
        cameraRef.current.position.set(center.x, center.y, center.z + cameraZ);
        cameraRef.current.lookAt(center);
        controlsRef.current.target.copy(center);
        controlsRef.current.update();
      }
    }, undefined, (error) => {
      console.error("Error loading STL file:", error);
    });
  }, [stlFile]); // Only re-run when stlFile changes


  // --- Effect to handle model scaling and camera adjustment ---
  useEffect(() => {
    if (!geometry || !sceneRef.current || originalDimensions.x === 0 || originalDimensions.y === 0 || originalDimensions.z === 0) {
      return;
    }

    const mesh = sceneRef.current.getObjectByName("stlMesh");
    const miniMesh = miniSceneRef.current ? miniSceneRef.current.getObjectByName("miniStlMesh") : null;
    if (!mesh) return;

    let newScaleX = 1, newScaleY = 1, newScaleZ = 1;
    if (originalDimensions.x > 0 && targetDimensions.width > 0) {
      newScaleX = targetDimensions.width / originalDimensions.x;
    }
    if (originalDimensions.y > 0 && targetDimensions.height > 0) {
      newScaleY = targetDimensions.height / originalDimensions.y;
    }
    if (originalDimensions.z > 0 && targetDimensions.depth > 0) {
      newScaleZ = targetDimensions.depth / originalDimensions.z;
    }

    mesh.scale.set(newScaleX, newScaleY, newScaleZ);
    if (miniMesh) {
      miniMesh.scale.set(newScaleX, newScaleY, newScaleZ);
    }
    setCurrentScale({ x: newScaleX, y: newScaleY, z: newScaleZ });

    // Adjust camera for main viewer
    if (cameraRef.current && controlsRef.current) {
      const scaledSize = new THREE.Vector3(
        originalDimensions.x * newScaleX,
        originalDimensions.y * newScaleY,
        originalDimensions.z * newScaleZ
      );
      const scaledCenter = new THREE.Vector3();
      geometry.boundingBox.getCenter(scaledCenter);
      scaledCenter.multiply(new THREE.Vector3(newScaleX, newScaleY, newScaleZ));

      const maxDim = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);
      const fov = cameraRef.current.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
      cameraZ *= 1.5;

      cameraRef.current.position.set(scaledCenter.x, scaledCenter.y, scaledCenter.z + cameraZ);
      cameraRef.current.lookAt(scaledCenter);
      controlsRef.current.target.copy(scaledCenter);
      controlsRef.current.update();
    }

    // Adjust camera for mini-viewer
    if (miniCameraRef.current && miniMesh) {
      const scaledSize = new THREE.Vector3();
      geometry.boundingBox.getSize(scaledSize);
      scaledSize.multiply(new THREE.Vector3(newScaleX, newScaleY, newScaleZ));

      const scaledCenter = new THREE.Vector3();
      geometry.boundingBox.getCenter(scaledCenter);
      scaledCenter.multiply(new THREE.Vector3(newScaleX, newScaleY, newScaleZ));

      const maxDim = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);
      const fov = miniCameraRef.current.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
      cameraZ *= 1.5;

      miniCameraRef.current.position.set(scaledCenter.x, scaledCenter.y, scaledCenter.z + cameraZ);
      miniCameraRef.current.lookAt(scaledCenter);
    }

    setSlicingParams(prev => ({
      ...prev,
      scaleX: newScaleX,
      scaleY: newScaleY,
      scaleZ: newScaleZ,
      currentLayerIndex: 0,
    }));
    setShowMiddleSlice(false);
  }, [targetDimensions, originalDimensions, geometry]); // Removed sceneRef, cameraRef, controlsRef, miniSceneRef, miniCameraRef from deps

  // --- Effect to update model outline visibility ---
  useEffect(() => {
    if (sceneRef.current) {
      const modelOutline = sceneRef.current.getObjectByName("modelOutline");
      if (modelOutline) {
        modelOutline.visible = showModelOutline;
      }
    }
  }, [showModelOutline]);

  // --- Effect to toggle main model visibility based on showMiniViewer ---
  useEffect(() => {
    if (sceneRef.current) {
      const stlMesh = sceneRef.current.getObjectByName("stlMesh");
      const modelOutline = sceneRef.current.getObjectByName("modelOutline");
      if (stlMesh) {
        stlMesh.visible = !showMiniViewer;
      }
      if (modelOutline) {
        modelOutline.visible = !showMiniViewer && showModelOutline;
      }
    }
    // Toggle mini-viewer div display
    if (miniViewerMountRef.current) {
      miniViewerMountRef.current.style.display = showMiniViewer ? 'block' : 'none';
    }
  }, [showMiniViewer, showModelOutline]); // sceneRef is implicitly used via getObjectByName

  // --- Send slicing request to worker ---
  useEffect(() => {
    if (geometry && sceneRef.current && workerInstanceRef.current) {
      clearSlices(sceneRef.current);
      
      let sliceValueToRender = null;
      let showSlicesForWorker = debouncedSlicingParams.showSlices;

      if (showMiddleSlice && geometry.boundingBox) {
        const bboxMin = getScaledMinRangeValue(geometry, debouncedSlicingParams.slicingPlane, currentScale.x, currentScale.y, currentScale.z);
        const bboxMax = getScaledMaxRangeValue(geometry, debouncedSlicingParams.slicingPlane, currentScale.x, currentScale.y, currentScale.z);
        sliceValueToRender = (bboxMin + bboxMax) / 2;
        showSlicesForWorker = true;
      } else if (debouncedSlicingParams.singleSliceMode) {
        sliceValueToRender = debouncedSlicingParams.currentSliceValue;
      }

      if (showSlicesForWorker) {
        const positionArrayCopy = new Float32Array(geometry.attributes.position.array);
        const bboxData = {
          min: geometry.boundingBox.min.toArray(),
          max: geometry.boundingBox.max.toArray(),
        };

        workerInstanceRef.current.postMessage({
          type: 'sliceModel',
          payload: {
            positionArray: positionArrayCopy,
            bboxData: bboxData,
            sliceHeight: debouncedSlicingParams.sliceHeight,
            currentSlice: sliceValueToRender,
            slicingPlane: debouncedSlicingParams.slicingPlane,
            scaleX: currentScale.x,
            scaleY: currentScale.y,
            scaleZ: currentScale.z,
          }
        });
      }
    }
  }, [debouncedSlicingParams, geometry, showMiddleSlice, currentScale]); // sceneRef is implicitly used via clearSlices


  // --- Utility Functions ---
  const clearSlices = useCallback((scene) => {
    const slices = scene.children.filter((child) => child.name === "sliceLine");
    slices.forEach((line) => {
      scene.remove(line);
      if (line.geometry) line.geometry.dispose();
      if (line.material) line.material.dispose();
    });
  }, []);

  const getScaledMinRangeValue = useCallback((geom = geometry, plane = slicingParams.slicingPlane, scaleX = currentScale.x, scaleY = currentScale.y, scaleZ = currentScale.z) => {
    if (!geom || !geom.boundingBox) return 0;
    const minVal = geom.boundingBox.min[plane.toLowerCase()];
    if (plane === 'X') return minVal * scaleX;
    if (plane === 'Y') return minVal * scaleY;
    if (plane === 'Z') return minVal * scaleZ;
    return minVal;
  }, [geometry, slicingParams.slicingPlane, currentScale]);

  const getScaledMaxRangeValue = useCallback((geom = geometry, plane = slicingParams.slicingPlane, scaleX = currentScale.x, scaleY = currentScale.y, scaleZ = currentScale.z) => {
    if (!geom || !geom.boundingBox) return 100;
    const maxVal = geom.boundingBox.max[plane.toLowerCase()];
    if (plane === 'X') return maxVal * scaleX;
    if (plane === 'Y') return maxVal * scaleY;
    if (plane === 'Z') return maxVal * scaleZ;
    return maxVal;
  }, [geometry, slicingParams.slicingPlane, currentScale]);

  // --- Export Functions (unchanged) ---
  const exportSVG = () => {
    if (!sceneRef.current) return;
    const lines = sceneRef.current.children.filter((child) => child.name === "sliceLine");
    if (lines.length === 0) return;

    let currentXOffset = 0;
    let overallMinX = Infinity;
    let overallMinY = Infinity;
    let overallMaxX = -Infinity;
    let overallMaxY = -Infinity;

    const slicesToExport = [];

    lines.forEach((line) => {
      const pos = line.geometry.attributes.position;
      const segmentsForThisSlice = [];
      let sliceMinX = Infinity, sliceMinY = Infinity, sliceMaxX = -Infinity, sliceMaxY = -Infinity;

      for (let i = 0; i < pos.count; i += 2) {
        const p1x = pos.getX(i);
        const p1y = pos.getY(i);
        const p1z = pos.getZ(i);

        if (i + 1 >= pos.count) continue;
        
        const p2x = pos.getX(i + 1);
        const p2y = pos.getY(i + 1);
        const p2z = pos.getZ(i + 1);

        let px1, py1, px2, py2;

        if (slicingParams.slicingPlane === "Z") {
          px1 = p1x; py1 = p1y;
          px2 = p2x; py2 = p2y;
        } else if (slicingParams.slicingPlane === "X") {
          px1 = p1z; py1 = p1y;
          px2 = p2z; py2 = p2y;
        } else {
          px1 = p1x; py1 = p1z;
          px2 = p2x; py2 = p2z;
        }

        sliceMinX = Math.min(sliceMinX, px1, px2);
        sliceMinY = Math.min(sliceMinY, py1, py2);
        sliceMaxX = Math.max(sliceMaxX, px1, px2);
        sliceMaxY = Math.max(sliceMaxY, py1, py2);

        segmentsForThisSlice.push({ p1: [px1, py1], p2: [px2, py2] });
      }

      if (segmentsForThisSlice.length > 0) {
        const sliceWidth = sliceMaxX - sliceMinX;
        const sliceHeight = sliceMaxY - sliceMinY;

        slicesToExport.push({
          segments: segmentsForThisSlice,
          color: line.material.color.getHexString(),
          offsetX: currentXOffset,
          offsetY: 0,
          sliceMinX: sliceMinX,
          sliceMinY: sliceMinY,
          sliceHeight: sliceHeight
        });

        overallMinX = Math.min(overallMinX, currentXOffset + sliceMinX);
        overallMaxX = Math.max(overallMaxX, currentXOffset + sliceMaxX);
        overallMinY = Math.min(overallMinY, sliceMinY);
        overallMaxY = Math.max(overallY, sliceMaxY);

        currentXOffset += sliceWidth + 10;
      }
    });

    let svgPaths = "";
    slicesToExport.forEach(sliceData => {
      sliceData.segments.forEach(segment => {
        const px1 = segment.p1[0] + sliceData.offsetX;
        const py1 = segment.p1[1] + sliceData.offsetY;
        const px2 = segment.p2[0] + sliceData.offsetX;
        const py2 = segment.p2[1] + sliceData.offsetY;

        svgPaths += `<path d="M ${px1.toFixed(3)} ${(-py1).toFixed(3)} L ${px2.toFixed(3)} ${(-py2).toFixed(3)}" stroke="#${sliceData.color}" stroke-width="0.05" fill="none"/>`;
      });
    });

    const finalViewBoxMinX = overallMinX;
    const finalViewBoxMinY = -overallMaxY;
    const finalViewBoxWidth = overallMaxX - overallMinX;
    const finalViewBoxHeight = overallMaxY - overallMinY;

    const viewBoxString = `${finalViewBoxMinX.toFixed(3)} ${finalViewBoxMinY.toFixed(3)} ${finalViewBoxWidth.toFixed(3)} ${finalViewBoxHeight.toFixed(3)}`;

    const svgContent = `<?xml version="1.0" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="${viewBoxString}">
${svgPaths}
</svg>`;

    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    saveAs(blob, "slice.svg");
  };

  const exportDXF = () => {
    if (!sceneRef.current) return;
    const lines = sceneRef.current.children.filter((child) => child.name === "sliceLine");
    if (lines.length === 0) return;

    let currentXOffset = 0;
    const slicesToExport = [];

    lines.forEach((line) => {
      const pos = line.geometry.attributes.position;
      const segmentsForThisSlice = [];
      let sliceMinX = Infinity, sliceMaxX = -Infinity;

      for (let i = 0; i < pos.count; i += 2) {
        const p1x = pos.getX(i);
        const p1y = pos.getY(i);
        const p1z = pos.getZ(i);

        if (i + 1 >= pos.count) continue;
        
        const p2x = pos.getX(i + 1);
        const p2y = pos.getY(i + 1);
        const p2z = pos.getZ(i + 1);

        let dx1, dy1, dz1;
        let dx2, dy2, dz2;

        if (slicingParams.slicingPlane === "Z") {
          dx1 = p1x; dy1 = p1y; dz1 = 0;
          dx2 = p2x; dy2 = p2y; dz2 = 0;
        } else if (slicingParams.slicingPlane === "X") {
          dx1 = p1z; dy1 = p1y; dz1 = 0;
          dx2 = p2z; dy2 = p2y; dz2 = 0;
        } else {
          dx1 = p1x; dy1 = p1z; dz1 = 0;
          dx2 = p2x; dy2 = p2z; dz2 = 0;
        }

        sliceMinX = Math.min(sliceMinX, dx1, dx2);
        sliceMaxX = Math.max(sliceMaxX, dx1, dx2);

        segmentsForThisSlice.push({ p1: [dx1, dy1, dz1], p2: [dx2, dy2, dz2] });
      }

      if (segmentsForThisSlice.length > 0) {
        const sliceWidth = sliceMaxX - sliceMinX;

        slicesToExport.push({
          segments: segmentsForThisSlice,
          offsetX: currentXOffset,
          offsetY: 0
        });

        currentXOffset += sliceWidth + 10;
      }
    });

    let dxfContent = "0\nSECTION\n2\nENTITIES\n";
    slicesToExport.forEach(sliceData => {
      sliceData.segments.forEach(segment => {
        const p1 = segment.p1;
        const p2 = segment.p2;

        const dx1 = p1[0] + sliceData.offsetX;
        const dy1 = p1[1];
        const dz1 = p1[2];

        const dx2 = p2[0] + sliceData.offsetX;
        const dy2 = p2[1];
        const dz2 = p2[2];
        
        dxfContent +=
          `0\nLINE\n8\n0\n10\n${dx1.toFixed(3)}\n20\n${dy1.toFixed(3)}\n30\n${dz1.toFixed(3)}\n11\n${dx2.toFixed(3)}\n21\n${dy2.toFixed(3)}\n31\n${dz2.toFixed(3)}\n`;
      });
    });
    dxfContent += "0\nENDSEC\n0\nEOF";

    const blob = new Blob([dxfContent], { type: "application/dxf" });
    saveAs(blob, "slice.dxf");
  };

  const minRangeValue = getScaledMinRangeValue();
  const maxRangeValue = getScaledMaxRangeValue();

  let totalLayers = 0;
  let currentLayerIndex = slicingParams.currentLayerIndex;
  let modelDimensions = { x: 0, y: 0, z: 0 };

  if (geometry && geometry.boundingBox && slicingParams.sliceHeight > 0) {
    const range = maxRangeValue - minRangeValue;
    totalLayers = Math.floor(range / slicingParams.sliceHeight) + 1;

    currentLayerIndex = Math.max(0, Math.min(totalLayers > 0 ? totalLayers - 1 : 0, slicingParams.currentLayerIndex));

    modelDimensions = {
      x: (originalDimensions.x * currentScale.x).toFixed(2),
      y: (originalDimensions.y * currentScale.y).toFixed(2),
      z: (originalDimensions.z * currentScale.z).toFixed(2),
    };
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden' }}>
      <div style={{ padding: 10, background: '#282c34', color: 'white', borderBottom: '1px solid #444', zIndex: 10 }}>
        <label>
          Slice Height:
          <input
            type="number"
            step="0.1"
            min="0.1"
            value={slicingParams.sliceHeight}
            onChange={handleSliceHeightChange}
            style={{ marginLeft: 5, width: 60, padding: 3 }}
          />
        </label>

        <label style={{ marginLeft: 20 }}>
          <input
            type="checkbox"
            checked={slicingParams.showSlices}
            onChange={handleToggleSlices}
            style={{ marginRight: 5 }}
          />
          Show Slices
        </label>

        <label style={{ marginLeft: 20 }}>
          <input
            type="checkbox"
            checked={showModelOutline}
            onChange={handleToggleModelOutline}
            style={{ marginRight: 5 }}
          />
          Show Model Outline
        </label>

        <label style={{ marginLeft: 20 }}>
          <input
            type="checkbox"
            checked={showMiddleSlice}
            onChange={handleToggleMiddleSlice}
            style={{ marginRight: 5 }}
          />
          Show Middle Slice
        </label>

        <label style={{ marginLeft: 20 }}>
          <input
            type="checkbox"
            checked={showMiniViewer}
            onChange={handleToggleMiniViewer}
            style={{ marginRight: 5 }}
          />
          Show Model View
        </label>

        <label style={{ marginLeft: 20 }}>
          Plane:
          <select value={slicingParams.slicingPlane} onChange={handlePlaneChange} style={{ marginLeft: 5, padding: 3 }}>
            <option value="Z">Z</option>
            <option value="X">X</option>
            <option value="Y">Y</option>
          </select>
        </label>

        <label style={{ marginLeft: 20 }}>
          <input
            type="checkbox"
            checked={slicingParams.singleSliceMode}
            onChange={handleToggleSingleSliceMode}
            disabled={showMiddleSlice}
            style={{ marginRight: 5 }}
          />
          Single Slice Mode
        </label>

        <label style={{ marginLeft: 10, opacity: slicingParams.singleSliceMode && !showMiddleSlice ? 1 : 0.5 }}>
          Slice Position:
          <input
            type="range"
            min={0}
            max={totalLayers > 0 ? totalLayers - 1 : 0}
            step="1"
            value={currentLayerIndex}
            onChange={handleStepChange}
            disabled={!geometry || !slicingParams.singleSliceMode || totalLayers <= 1 || showMiddleSlice}
            style={{ marginLeft: 5, width: 150 }}
          />
          <span style={{ marginLeft: 5 }}>{slicingParams.currentSliceValue.toFixed(2)}</span>
        </label>
        
        <label style={{ marginLeft: 20 }}>
          Target Width (mm):
          <input
            type="number"
            step="0.1"
            min="0"
            value={targetDimensions.width.toFixed(2)}
            onChange={handleTargetDimensionChange('width')}
            style={{ marginLeft: 5, width: 80, padding: 3 }}
          />
        </label>
        <label style={{ marginLeft: 10 }}>
          Target Height (mm):
          <input
            type="number"
            step="0.1"
            min="0"
            value={targetDimensions.height.toFixed(2)}
            onChange={handleTargetDimensionChange('height')}
            style={{ marginLeft: 5, width: 80, padding: 3 }}
          />
        </label>
        <label style={{ marginLeft: 10 }}>
          Target Depth (mm):
          <input
            type="number"
            step="0.1"
            min="0"
            value={targetDimensions.depth.toFixed(2)}
            onChange={handleTargetDimensionChange('depth')}
            style={{ marginLeft: 5, width: 80, padding: 3 }}
          />
        </label>


        {geometry && (
          <>
            <span style={{ marginLeft: 20, fontSize: '0.9em' }}>
              Total Layers: {totalLayers} | Current Layer: {currentLayerIndex + 1}
            </span>
            <span style={{ marginLeft: 20, fontSize: '0.9em' }}>
              Dimensions (mm): L {modelDimensions.x} W {modelDimensions.y} H {modelDimensions.z}
            </span>
          </>
        )}

        <button onClick={exportSVG} style={{ marginLeft: 20, padding: '5px 10px', cursor: 'pointer' }}>
          Export SVG
        </button>
        <button onClick={exportDXF} style={{ marginLeft: 10, padding: '5px 10px', cursor: 'pointer' }}>
          Export DXF
        </button>
      </div>
      <div ref={mountRef} style={{ width: "100%", height: "calc(100vh - 50px)" }} />
      {/* Mini-viewer div, its display is toggled by showMiniViewer state */}
      <div 
        ref={miniViewerMountRef} 
        style={{ 
          position: 'absolute', 
          top: '10px', 
          right: '10px', 
          width: '25%', 
          height: '25%', 
          border: '1px solid #555', 
          boxShadow: '0 0 10px rgba(0,0,0,0.5)',
          zIndex: 9,
          display: showMiniViewer ? 'block' : 'none' // Controlled by state
        }} 
      />
    </div>
  );
};

export default STLViewer;
