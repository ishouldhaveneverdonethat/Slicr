import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from "file-saver";

// Correct way to import a Web Worker in modern bundlers (like Create React App v5+)
// This creates a URL for the worker script which can then be instantiated.
const SlicerWorker = new Worker(new URL('../workers/slicerWorker.js', import.meta.url));


const STLViewer = ({ stlFile }) => {
  // --- 1. Model and Geometry State ---
  const mountRef = useRef(null);
  const [sceneState, setSceneState] = useState({ scene: null, renderer: null, camera: null, controls: null });
  const [geometry, setGeometry] = useState(null);
  const [originalDimensions, setOriginalDimensions] = useState({ x: 0, y: 0, z: 0 });
  const [targetDimensions, setTargetDimensions] = useState({ width: 0, height: 0, depth: 0 });
  const [currentScale, setCurrentScale] = useState({ x: 1, y: 1, z: 1 }); // Actual scale applied

  // --- 3. Slicing Logic State ---
  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 2,
    showSlices: true,
    currentLayerIndex: 0, // Changed to layer index
    currentSliceValue: 0, // Actual coordinate value
    singleSliceMode: false,
    slicingPlane: "Z",
    // scaleX, scaleY, scaleZ are now derived from currentScale in the useEffect
  });

  // --- New state for controlling model outline visibility ---
  const [showModelOutline, setShowModelOutline] = useState(true); // Default to true
  // --- New state for showing middle slice ---
  const [showMiddleSlice, setShowMiddleSlice] = useState(false); // Default to false

  // --- Debounce state for slicing ---
  const [debouncedSlicingParams, setDebouncedSlicingParams] = useState(slicingParams);
  // State to hold the worker instance (now directly the instantiated worker)
  const workerInstanceRef = useRef(null); // Renamed to avoid confusion with the Worker constructor

  // Initialize Web Worker
  useEffect(() => {
    // Assign the imported worker instance to the ref
    workerInstanceRef.current = SlicerWorker;

    workerInstanceRef.current.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'slicingComplete') {
        // Clear old slices before rendering new ones
        clearSlices(sceneState.scene);
        
        payload.forEach(sliceData => {
          const { value: slicePlaneValue, contours, isFallback, plane } = sliceData;
          
          if (contours.length === 0) return;

          // If isFallback is true, it means we are rendering raw segments (pairs of points)
          // Otherwise, it implies ClipperLib successfully generated closed contours
          const materialColor = isFallback ? 0x00ff00 : 0xff0000; // Green for fallback (raw segments), Red for Clipper (closed contours)
          const sliceMaterial = new THREE.LineBasicMaterial({ color: materialColor });

          const sliceGeometry = new THREE.BufferGeometry();
          sliceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(contours), 3));

          let sliceLine;
          if (isFallback) {
            // For raw segments, it's LineSegments (pairs of points)
            sliceLine = new THREE.LineSegments(sliceGeometry, sliceMaterial);
          } else {
            // For Clipper contours, it's LineLoop (closed polygon)
            // Ensure the loop is closed by duplicating the first point if necessary
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
          sceneState.scene.add(sliceLine);
        });
      }
    };

    // No need to terminate here as the worker is a singleton created outside the component
    // If you wanted a new worker instance per component mount, you'd create `new Worker(...)` here
    // and return `workerInstanceRef.current.terminate()` in the cleanup.
    // For performance, a single shared worker is often better for this kind of task.
    // However, if the worker needs to be reset or if multiple instances are needed,
    // you would manage its lifecycle within this useEffect.
  }, [sceneState.scene]);


  // Custom debounce hook for slicing parameters
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSlicingParams(slicingParams);
    }, 200); // Debounce delay: 200ms

    return () => {
      clearTimeout(handler);
    };
  }, [slicingParams]);


  // --- 4. UI Controls Handlers ---
  const handleSliceHeightChange = (e) => {
    setSlicingParams((p) => ({
      ...p,
      sliceHeight: parseFloat(e.target.value),
      singleSliceMode: false,
      currentLayerIndex: 0, // Reset layer index when height changes
    }));
    setShowMiddleSlice(false); // Disable middle slice when height changes
  };

  const handlePlaneChange = (e) => {
    setSlicingParams((p) => ({
      ...p,
      slicingPlane: e.target.value,
      singleSliceMode: false,
      currentLayerIndex: 0, // Reset layer index when plane changes
    }));
    setShowMiddleSlice(false); // Disable middle slice when plane changes
  };

  const handleToggleSlices = () => {
    setSlicingParams((p) => ({ ...p, showSlices: !p.showSlices }));
  };

  const handleStepChange = (e) => {
    const newLayerIndex = parseInt(e.target.value, 10);
    // Calculate the actual slice coordinate based on the layer index
    const calculatedSliceValue = getScaledMinRangeValue() + newLayerIndex * slicingParams.sliceHeight;

    setSlicingParams((p) => ({
      ...p,
      currentLayerIndex: newLayerIndex,
      currentSliceValue: calculatedSliceValue, // Update the actual coordinate
      singleSliceMode: true,
      showSlices: true,
    }));
    setShowMiddleSlice(false); // Disable middle slice when manual slice is adjusted
  };

  const handleToggleSingleSliceMode = () => {
    setSlicingParams((p) => ({
      ...p,
      singleSliceMode: !p.singleSliceMode,
    }));
    setShowMiddleSlice(false); // Disable middle slice when toggling single slice mode
  };

  // Handler for model outline visibility
  const handleToggleModelOutline = () => {
    setShowModelOutline(prev => !prev);
  };

  // Handler for middle slice visibility
  const handleToggleMiddleSlice = () => {
    setShowMiddleSlice(prev => !prev);
    // When middle slice is toggled, disable single slice mode and show all slices
    setSlicingParams(prev => ({
      ...prev,
      singleSliceMode: false, // Disable manual single slice
      showSlices: true, // Ensure slices are visible
    }));
  };

  // New: Handlers for target dimension changes with proportional scaling
  const handleTargetDimensionChange = (dimension) => (e) => {
    const inputValue = parseFloat(e.target.value);
    if (isNaN(inputValue) || inputValue <= 0) {
      // Optionally reset to original or prevent update if invalid
      // For proportional scaling, if input is invalid, it's better to revert to current
      // or simply not update, to avoid breaking aspect ratio with 0 or NaN.
      return;
    }

    if (originalDimensions.x === 0 || originalDimensions.y === 0 || originalDimensions.z === 0) {
        // This case should ideally not happen if originalDimensions are always > 0
        // If original dimension is zero, we can't calculate a proportional scale.
        // Just set the target dimension directly for the changed axis.
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

    // Apply the calculated scaleFactor to all dimensions based on original dimensions
    const newTargetWidth = originalDimensions.x * scaleFactor;
    const newTargetHeight = originalDimensions.y * scaleFactor;
    const newTargetDepth = originalDimensions.z * scaleFactor;

    setTargetDimensions({
      width: newTargetWidth,
      height: newTargetHeight,
      depth: newTargetDepth,
    });
  };


  // --- 2. Scene Setup and Render ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    while (mount.firstChild) {
      mount.removeChild(mount.firstChild);
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true }); // Enable anti-aliasing
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

    const handleResize = () => {
      if (mount) {
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      }
    };
    window.addEventListener("resize", handleResize);

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    setSceneState({ scene, renderer, camera, controls });

    return () => {
      window.removeEventListener("resize", handleResize);
      controls.dispose();
      renderer.dispose();
    };
  }, []); // Empty dependency array means this runs once on mount

  // --- 1. STL Loader & Mesh Setup ---
  useEffect(() => {
    if (!sceneState.scene || !stlFile) return;

    const loader = new STLLoader();
    loader.load(stlFile, (loadedGeometry) => {
      loadedGeometry.computeBoundingBox();
      setGeometry(loadedGeometry);

      const initialSize = new THREE.Vector3();
      loadedGeometry.boundingBox.getSize(initialSize);
      setOriginalDimensions({ x: initialSize.x, y: initialSize.y, z: initialSize.z });
      // Initialize target dimensions to original dimensions when a new model is loaded
      setTargetDimensions({ width: initialSize.x, height: initialSize.y, depth: initialSize.z });

      // Changed material to be fully opaque
      const material = new THREE.MeshPhongMaterial({
        color: 0x00aaff,
        transparent: false, // Ensure not transparent
        opacity: 1,         // Ensure full opacity
      });
      const mesh = new THREE.Mesh(loadedGeometry, material);

      const center = new THREE.Vector3();
      loadedGeometry.boundingBox.getCenter(center);
      mesh.position.sub(center);
      mesh.name = "stlMesh";
      
      // Do NOT apply scale here initially, it will be done in a separate useEffect
      const scene = sceneState.scene;
      const existingMesh = scene.getObjectByName("stlMesh");
      if (existingMesh) {
        scene.remove(existingMesh);
        if (existingMesh.geometry) existingMesh.geometry.dispose();
        if (existingMesh.material) existingMesh.material.dispose();
      }
      scene.add(mesh);

      // --- Add Model Outline Logic ---
      const existingOutline = scene.getObjectByName("modelOutline");
      if (existingOutline) {
        scene.remove(existingOutline);
        if (existingOutline.geometry) existingOutline.geometry.dispose();
        if (existingOutline.material) existingOutline.material.dispose();
      }

      // Create EdgesGeometry for clean outlines
      const edges = new THREE.EdgesGeometry(loadedGeometry, 30); // Threshold angle 30 degrees
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: 0x000000, // Black outlines
        linewidth: 2, // Note: linewidth often ignored by WebGL, usually renders as 1px
        transparent: true,
        opacity: 0.8,
        depthTest: true,  // Crucial: only draw if in front of existing geometry
        depthWrite: false // Crucial: don't write to depth buffer, allows mesh to obscure lines behind it
      });
      const modelOutlines = new THREE.LineSegments(edges, outlineMaterial);
      modelOutlines.name = "modelOutline";
      modelOutlines.visible = showModelOutline; // Control visibility based on state
      scene.add(modelOutlines);
      // --- End Model Outline Logic ---


      // Camera and controls will be updated by the scaling useEffect
    },
    undefined,
    (error) => {
      // Using console.log instead of alert() as per instructions
      console.error("Error loading STL file:", error);
    });
  }, [stlFile, sceneState.scene, showModelOutline]); // Removed camera/controls from deps here, handled by scaling effect


  // --- Effect to handle model scaling and camera adjustment ---
  useEffect(() => {
    if (!geometry || !sceneState.scene || originalDimensions.x === 0 || originalDimensions.y === 0 || originalDimensions.z === 0) {
      // If original dimensions are zero, or geometry/scene not ready, cannot calculate scale
      // Also, if original dimensions are 0, we can't calculate a valid scale factor for proportional scaling.
      // This might happen if the STL file is invalid or has degenerate geometry.
      return;
    }

    const mesh = sceneState.scene.getObjectByName("stlMesh");
    if (!mesh) return;

    let newScaleX = 1, newScaleY = 1, newScaleZ = 1;

    // Calculate scales based on target dimensions relative to original dimensions
    // Handle cases where original dimension might be 0 to prevent division by zero
    if (originalDimensions.x > 0 && targetDimensions.width > 0) {
      newScaleX = targetDimensions.width / originalDimensions.x;
    }
    if (originalDimensions.y > 0 && targetDimensions.height > 0) {
      newScaleY = targetDimensions.height / originalDimensions.y;
    }
    if (originalDimensions.z > 0 && targetDimensions.depth > 0) {
      newScaleZ = targetDimensions.depth / originalDimensions.z;
    }

    // Apply scale to the mesh
    mesh.scale.set(newScaleX, newScaleY, newScaleZ);
    setCurrentScale({ x: newScaleX, y: newScaleY, z: newScaleZ }); // Store actual applied scale


    // Update camera and controls based on new scale
    if (sceneState.camera && sceneState.controls) {
      const scaledSize = new THREE.Vector3(
        originalDimensions.x * newScaleX,
        originalDimensions.y * newScaleY,
        originalDimensions.z * newScaleZ
      );
      const scaledCenter = new THREE.Vector3();
      geometry.boundingBox.getCenter(scaledCenter); // Get original center
      scaledCenter.multiply(new THREE.Vector3(newScaleX, newScaleY, newScaleZ)); // Scale the center

      const maxDim = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);
      const fov = sceneState.camera.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
      cameraZ *= 1.5; // Add some padding

      sceneState.camera.position.set(scaledCenter.x, scaledCenter.y, scaledCenter.z + cameraZ);
      sceneState.camera.lookAt(scaledCenter);
      sceneState.controls.target.copy(scaledCenter);
      sceneState.controls.update();
    }

    // Update slicingParams with the new scale factors
    setSlicingParams(prev => ({
      ...prev,
      scaleX: newScaleX,
      scaleY: newScaleY,
      scaleZ: newScaleZ,
      currentLayerIndex: 0, // Reset layer index on scale change
    }));
    setShowMiddleSlice(false); // Disable middle slice on scale change

  }, [targetDimensions, originalDimensions, geometry, sceneState.scene, sceneState.camera, sceneState.controls]);


  // --- Effect to update model outline visibility when showModelOutline changes ---
  useEffect(() => {
    if (sceneState.scene) {
      const modelOutline = sceneState.scene.getObjectByName("modelOutline");
      if (modelOutline) {
        modelOutline.visible = showModelOutline;
      }
    }
  }, [showModelOutline, sceneState.scene]);


  // --- Send slicing request to worker when debounced params or geometry change ---
  useEffect(() => {
    if (geometry && sceneState.scene && workerInstanceRef.current) {
      clearSlices(sceneState.scene); // Clear old slices immediately
      
      let sliceValueToRender = null;
      let showSlicesForWorker = debouncedSlicingParams.showSlices;

      if (showMiddleSlice && geometry.boundingBox) {
        // Calculate middle slice value based on scaled bounding box
        const bboxMin = getScaledMinRangeValue(geometry, debouncedSlicingParams.slicingPlane, currentScale.x, currentScale.y, currentScale.z);
        const bboxMax = getScaledMaxRangeValue(geometry, debouncedSlicingParams.slicingPlane, currentScale.x, currentScale.y, currentScale.z);
        sliceValueToRender = (bboxMin + bboxMax) / 2;
        showSlicesForWorker = true; // Ensure slices are shown if middle slice is active
      } else if (debouncedSlicingParams.singleSliceMode) {
        sliceValueToRender = debouncedSlicingParams.currentSliceValue;
      }

      if (showSlicesForWorker) {
        const positionArrayCopy = new Float32Array(geometry.attributes.position.array);
        const bboxData = {
          min: geometry.boundingBox.min.toArray(), // Original unscaled bbox data
          max: geometry.boundingBox.max.toArray(), // Original unscaled bbox data
        };

        workerInstanceRef.current.postMessage({
          type: 'sliceModel',
          payload: {
            positionArray: positionArrayCopy, // Send the copy
            bboxData: bboxData,
            sliceHeight: debouncedSlicingParams.sliceHeight,
            currentSlice: sliceValueToRender, // Pass the calculated or selected slice value
            slicingPlane: debouncedSlicingParams.slicingPlane,
            scaleX: currentScale.x, // Pass current actual scale factors to worker
            scaleY: currentScale.y,
            scaleZ: currentScale.z,
          }
        });
      }
    }
  }, [debouncedSlicingParams, geometry, sceneState.scene, showMiddleSlice, currentScale]);


  // --- 6. Utility Functions ---
  const clearSlices = (scene) => {
    const slices = scene.children.filter((child) => child.name === "sliceLine");
    slices.forEach((line) => {
      scene.remove(line);
      if (line.geometry) line.geometry.dispose();
      if (line.material) line.material.dispose();
    });
  };

  // Helper to get scaled min range value
  const getScaledMinRangeValue = useCallback((geom = geometry, plane = slicingParams.slicingPlane, scaleX = currentScale.x, scaleY = currentScale.y, scaleZ = currentScale.z) => {
    if (!geom || !geom.boundingBox) return 0;
    const minVal = geom.boundingBox.min[plane.toLowerCase()];
    if (plane === 'X') return minVal * scaleX;
    if (plane === 'Y') return minVal * scaleY;
    if (plane === 'Z') return minVal * scaleZ;
    return minVal;
  }, [geometry, slicingParams.slicingPlane, currentScale]);

  // Helper to get scaled max range value
  const getScaledMaxRangeValue = useCallback((geom = geometry, plane = slicingParams.slicingPlane, scaleX = currentScale.x, scaleY = currentScale.y, scaleZ = currentScale.z) => {
    if (!geom || !geom.boundingBox) return 100;
    const maxVal = geom.boundingBox.max[plane.toLowerCase()];
    if (plane === 'X') return maxVal * scaleX;
    if (plane === 'Y') return maxVal * scaleY;
    if (plane === 'Z') return maxVal * scaleZ;
    return maxVal;
  }, [geometry, slicingParams.slicingPlane, currentScale]);


  // --- 5. Export Functions ---
  const exportSVG = () => {
    if (!sceneState.scene) return;
    const lines = sceneState.scene.children.filter((child) => child.name === "sliceLine");
    if (lines.length === 0) return; // Removed console.log

    let currentXOffset = 0;
    let overallMinX = Infinity;
    let overallMinY = Infinity;
    let overallMaxX = -Infinity;
    let overallMaxY = -Infinity;

    const slicesToExport = []; // Store processed slice data for export

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

        // Project 3D points to 2D plane based on slicingPlane
        if (slicingParams.slicingPlane === "Z") {
          px1 = p1x; py1 = p1y;
          px2 = p2x; py2 = p2y;
        } else if (slicingParams.slicingPlane === "X") {
          px1 = p1z; py1 = p1y; // X-plane, so use Z and Y coordinates
          px2 = p2z; py2 = p2y;
        } else { // Y plane
          px1 = p1x; py1 = p1z; // Y-plane, so use X and Z coordinates
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
          offsetY: 0, // For a single row layout
          sliceMinX: sliceMinX, // Original min X for this slice
          sliceMinY: sliceMinY, // Original min Y for this slice
          sliceHeight: sliceHeight // Height of this slice
        });

        // Update overall bounding box for viewBox calculation
        overallMinX = Math.min(overallMinX, currentXOffset + sliceMinX);
        overallMaxX = Math.max(overallMaxX, currentXOffset + sliceMaxX);
        overallMinY = Math.min(overallMinY, sliceMinY); // No offsetY for Y bounds
        overallMaxY = Math.max(overallMaxY, sliceMaxY); // No offsetY for Y bounds

        currentXOffset += sliceWidth + 10; // Add 10mm spacing
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

    // Calculate final viewBox based on overall min/max
    const finalViewBoxMinX = overallMinX;
    const finalViewBoxMinY = -overallMaxY; // Invert Y for SVG viewBox
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
    if (!sceneState.scene) return;
    const lines = sceneState.scene.children.filter((child) => child.name === "sliceLine");
    if (lines.length === 0) return; // Removed console.log

    let currentXOffset = 0;
    const slicesToExport = []; // Store processed slice data for export

    lines.forEach((line) => {
      const pos = line.geometry.attributes.position;
      const segmentsForThisSlice = [];
      let sliceMinX = Infinity, sliceMaxX = -Infinity; // Only need X for width calculation

      for (let i = 0; i < pos.count; i += 2) { // Iterate by 2 for start and end of each segment
        const p1x = pos.getX(i);
        const p1y = pos.getY(i);
        const p1z = pos.getZ(i);

        if (i + 1 >= pos.count) continue; 
        
        const p2x = pos.getX(i + 1);
        const p2y = pos.getY(i + 1);
        const p2z = pos.getZ(i + 1);

        let dx1, dy1, dz1;
        let dx2, dy2, dz2;

        // Project 3D points to 2D plane for DXF
        if (slicingParams.slicingPlane === "Z") {
          dx1 = p1x; dy1 = p1y; dz1 = 0;
          dx2 = p2x; dy2 = p2y; dz2 = 0;
        } else if (slicingParams.slicingPlane === "X") {
          dx1 = p1z; dy1 = p1y; dz1 = 0; // X-plane, so use Z and Y coordinates
          dx2 = p2z; dy2 = p2y; dz2 = 0;
        } else { // Y plane
          dx1 = p1x; dy1 = p1z; dz1 = 0; // Y-plane, so use X and Z coordinates
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
          offsetY: 0 // For a single row layout
        });

        currentXOffset += sliceWidth + 10; // Add 10mm spacing
      }
    });

    let dxfContent = "0\nSECTION\n2\nENTITIES\n";
    slicesToExport.forEach(sliceData => {
      sliceData.segments.forEach(segment => {
        const p1 = segment.p1;
        const p2 = segment.p2;

        // Apply offset to X coordinate
        const dx1 = p1[0] + sliceData.offsetX;
        const dy1 = p1[1];
        const dz1 = p1[2];

        const dx2 = p2[0] + sliceData.offsetX;
        const dy2 = p2[1];
        const dz2 = p2[2];
        
        // Add a LINE entity for each segment
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
  let currentLayerIndex = slicingParams.currentLayerIndex; // Use from state
  let modelDimensions = { x: 0, y: 0, z: 0 };

  if (geometry && geometry.boundingBox && slicingParams.sliceHeight > 0) {
    const range = maxRangeValue - minRangeValue;
    totalLayers = Math.floor(range / slicingParams.sliceHeight) + 1;

    // Clamp currentLayerIndex to valid range
    currentLayerIndex = Math.max(0, Math.min(totalLayers > 0 ? totalLayers - 1 : 0, slicingParams.currentLayerIndex));

    modelDimensions = {
      x: (originalDimensions.x * currentScale.x).toFixed(2),
      y: (originalDimensions.y * currentScale.y).toFixed(2),
      z: (originalDimensions.z * currentScale.z).toFixed(2),
    };
  }

  return (
    <div>
      <div style={{ padding: 10, background: '#282c34', color: 'white', borderBottom: '1px solid #444' }}>
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
            checked={showModelOutline} // Use new state
            onChange={handleToggleModelOutline} // New handler
            style={{ marginRight: 5 }}
          />
          Show Model Outline {/* New UI label */}
        </label>

        <label style={{ marginLeft: 20 }}>
          <input
            type="checkbox"
            checked={showMiddleSlice} // New state
            onChange={handleToggleMiddleSlice} // New handler
            style={{ marginRight: 5 }}
          />
          Show Middle Slice {/* New UI label */}
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
            disabled={showMiddleSlice} // Disable if middle slice is active
            style={{ marginRight: 5 }}
          />
          Single Slice Mode
        </label>

        <label style={{ marginLeft: 10, opacity: slicingParams.singleSliceMode && !showMiddleSlice ? 1 : 0.5 }}>
          Slice Position:
          <input
            type="range"
            min={0} // Min is now 0 (first layer index)
            max={totalLayers > 0 ? totalLayers - 1 : 0} // Max is total layers - 1
            step="1" // Step by 1 for layer index
            value={currentLayerIndex} // Use currentLayerIndex for the slider
            onChange={handleStepChange}
            disabled={!geometry || !slicingParams.singleSliceMode || totalLayers <= 1 || showMiddleSlice} // Disable if only 1 layer or middle slice is active
            style={{ marginLeft: 5, width: 150 }}
          />
          <span style={{ marginLeft: 5 }}>{slicingParams.currentSliceValue.toFixed(2)}</span> {/* Display actual coordinate */}
        </label>
        
        {/* New Target Dimension Controls */}
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
    </div>
  );
};

export default STLViewer;
