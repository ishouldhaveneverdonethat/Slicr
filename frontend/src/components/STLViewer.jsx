import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from "file-saver";

// --- Helper Functions (Moved outside component for stability) ---

// Correct way to import a Web Worker in modern bundlers
const SlicerWorker = new Worker(new URL('../workers/slicerWorker.js', import.meta.url));

/**
 * Removes all slice line objects from a scene and disposes their resources.
 */
const clearSlices = (scene) => {
  const slices = scene.children.filter((child) => child.name === "sliceLine");
  slices.forEach((line) => {
    scene.remove(line);
    if (line.geometry) line.geometry.dispose();
    if (line.material) line.material.dispose();
  });
};

/**
 * Calculates the minimum coordinate of the geometry's bounding box along a given plane, adjusted by scale.
 */
const getScaledMinRangeValue = (geom, plane, scale) => {
  if (!geom?.boundingBox?.min) return 0;
  const minVal = geom.boundingBox.min[plane.toLowerCase()];
  if (!Number.isFinite(minVal)) return 0;

  if (plane === 'X') return minVal * scale.x;
  if (plane === 'Y') return minVal * scale.y;
  if (plane === 'Z') return minVal * scale.z;
  return minVal;
};

/**
 * Calculates the maximum coordinate of the geometry's bounding box along a given plane, adjusted by scale.
 */
const getScaledMaxRangeValue = (geom, plane, scale) => {
  if (!geom?.boundingBox?.max) return 100;
  const maxVal = geom.boundingBox.max[plane.toLowerCase()];
  if (!Number.isFinite(maxVal)) return 100;

  if (plane === 'X') return maxVal * scale.x;
  if (plane === 'Y') return maxVal * scale.y;
  if (plane === 'Z') return maxVal * scale.z;
  return maxVal;
};


// --- React Component ---

const STLViewer = ({ stlFile }) => {
  // --- Refs for Three.js objects ---
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const workerInstanceRef = useRef(null);

  // --- React State ---
  const [geometry, setGeometry] = useState(null);
  const [originalDimensions, setOriginalDimensions] = useState({ x: 0, y: 0, z: 0 });
  const [targetDimensions, setTargetDimensions] = useState({ width: 0, height: 0, depth: 0 });
  const [currentScale, setCurrentScale] = useState({ x: 1, y: 1, z: 1 });

  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 2,
    showSlices: true,
    currentLayerIndex: 0,
    currentSliceValue: 0,
    singleSliceMode: false,
    slicingPlane: "Z",
  });
  const [debouncedSlicingParams, setDebouncedSlicingParams] = useState(slicingParams);

  const [showModelOutline, setShowModelOutline] = useState(true);
  const [showMiddleSlice, setShowMiddleSlice] = useState(false);

  // --- Web Worker Initialization and Message Handling ---
  useEffect(() => {
    workerInstanceRef.current = SlicerWorker;
    workerInstanceRef.current.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'slicingComplete' && sceneRef.current) {
        clearSlices(sceneRef.current);

        payload.forEach(sliceData => {
          const { contours, isFallback } = sliceData;
          if (contours.length === 0) return;

          const materialColor = isFallback ? 0x00ff00 : 0xff0000;
          const sliceMaterial = new THREE.LineBasicMaterial({ color: materialColor });
          const sliceGeometry = new THREE.BufferGeometry();
          sliceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(contours), 3));
          
          const sliceLine = new THREE.LineSegments(sliceGeometry, sliceMaterial);
          sliceLine.name = "sliceLine";
          sceneRef.current.add(sliceLine);
        });
      }
    };
  }, []); // Empty dependency array ensures this runs only once

  // --- Debounce Slicing Parameters ---
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSlicingParams(slicingParams);
    }, 200);
    return () => clearTimeout(handler);
  }, [slicingParams]);


  // --- UI Controls Handlers ---
  const handleSliceHeightChange = useCallback((e) => {
    setSlicingParams(p => ({
      ...p,
      sliceHeight: parseFloat(e.target.value) || 0.1,
      singleSliceMode: false, // Reset dependent modes
      currentLayerIndex: 0,
    }));
    setShowMiddleSlice(false);
  }, []);

  const handlePlaneChange = useCallback((e) => {
    setSlicingParams(p => ({
      ...p,
      slicingPlane: e.target.value,
      singleSliceMode: false, // Reset dependent modes
      currentLayerIndex: 0,
    }));
    setShowMiddleSlice(false);
  }, []);

  const handleToggleSlices = useCallback(() => {
    setSlicingParams(p => ({ ...p, showSlices: !p.showSlices }));
  }, []);

  const handleStepChange = useCallback((e) => {
    if (!geometry?.boundingBox) return;

    const newLayerIndex = parseInt(e.target.value, 10);
    const scaledMin = getScaledMinRangeValue(geometry, slicingParams.slicingPlane, currentScale);
    const calculatedSliceValue = scaledMin + newLayerIndex * slicingParams.sliceHeight;

    setSlicingParams(p => ({
      ...p,
      currentLayerIndex: newLayerIndex,
      currentSliceValue: calculatedSliceValue,
      singleSliceMode: true,
      showSlices: true,
    }));
    setShowMiddleSlice(false);
  }, [geometry, slicingParams.sliceHeight, slicingParams.slicingPlane, currentScale]);

  const handleToggleSingleSliceMode = useCallback(() => {
    setSlicingParams(p => ({ ...p, singleSliceMode: !p.singleSliceMode }));
    setShowMiddleSlice(false);
  }, []);
  
  const handleToggleModelOutline = useCallback(() => {
    setShowModelOutline(prev => !prev);
  }, []);

  const handleToggleMiddleSlice = useCallback(() => {
    setShowMiddleSlice(prev => {
        const isShowingMiddle = !prev;
        if (isShowingMiddle) {
            setSlicingParams(p => ({
                ...p,
                singleSliceMode: false, // Ensure single slice is off
                showSlices: true,
            }));
        }
        return isShowingMiddle;
    });
  }, []);
  
  const handleTargetDimensionChange = useCallback((dimension) => (e) => {
    const inputValue = parseFloat(e.target.value);
    if (isNaN(inputValue)) return;

    // Check if original dimensions are valid for proportional scaling
    const canScaleProportionally = 
        originalDimensions.x > 0 &&
        originalDimensions.y > 0 &&
        originalDimensions.z > 0;

    if (!canScaleProportionally) {
        setTargetDimensions(prev => ({...prev, [dimension]: inputValue }));
        return;
    }

    let scaleFactor = 1;
    if (dimension === 'width') scaleFactor = inputValue / originalDimensions.x;
    else if (dimension === 'height') scaleFactor = inputValue / originalDimensions.y;
    else if (dimension === 'depth') scaleFactor = inputValue / originalDimensions.z;

    setTargetDimensions({
      width: originalDimensions.x * scaleFactor,
      height: originalDimensions.y * scaleFactor,
      depth: originalDimensions.z * scaleFactor,
    });
  }, [originalDimensions]);


  // --- Three.js Scene Initialization (Runs only once) ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    while (mount.firstChild) mount.removeChild(mount.firstChild);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 50, 100).normalize();
    scene.add(directionalLight);

    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    controlsRef.current = controls;

    const handleResize = () => {
      if (cameraRef.current && rendererRef.current && mountRef.current) {
        cameraRef.current.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      }
    };
    window.addEventListener("resize", handleResize);

    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controlsRef.current.update();
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };
    animate();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
      controlsRef.current.dispose();
      rendererRef.current.dispose();
    };
  }, []);

  // --- STL File Loading and Scene Setup ---
  useEffect(() => {
    if (!sceneRef.current || !stlFile) return;

    // Clear previous model and slices
    const existingMesh = sceneRef.current.getObjectByName("stlMesh");
    if (existingMesh) sceneRef.current.remove(existingMesh);
    const existingOutline = sceneRef.current.getObjectByName("modelOutline");
    if (existingOutline) sceneRef.current.remove(existingOutline);
    clearSlices(sceneRef.current);

    const loader = new STLLoader();
    loader.load(stlFile, (loadedGeometry) => {
      loadedGeometry.computeBoundingBox();
      const initialSize = new THREE.Vector3();
      loadedGeometry.boundingBox.getSize(initialSize);

      setGeometry(loadedGeometry);
      setOriginalDimensions({ x: initialSize.x, y: initialSize.y, z: initialSize.z });
      setTargetDimensions({ width: initialSize.x, height: initialSize.y, depth: initialSize.z });
      
      const material = new THREE.MeshPhongMaterial({ color: 0x00aaff });
      const mesh = new THREE.Mesh(loadedGeometry, material);
      mesh.name = "stlMesh";

      const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(loadedGeometry, 30),
          new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 })
      );
      outline.name = "modelOutline";

      const group = new THREE.Group();
      group.add(mesh);
      group.add(outline);
      
      const center = new THREE.Vector3();
      loadedGeometry.boundingBox.getCenter(center);
      group.position.sub(center); // Center the whole group
      sceneRef.current.add(group);
      
      // Reset camera to fit new model
      if (cameraRef.current && controlsRef.current) {
        const maxDim = Math.max(initialSize.x, initialSize.y, initialSize.z);
        const fov = cameraRef.current.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / Math.tan(fov / 2));
        cameraZ *= 1.2; // Zoom out a bit
        cameraRef.current.position.set(0, 0, cameraZ);
        controlsRef.current.target.set(0,0,0);
        controlsRef.current.update();
      }
    }, undefined, (error) => console.error("Error loading STL file:", error));
  }, [stlFile]);

  // --- Model Scaling ---
  useEffect(() => {
    const group = sceneRef.current?.getObjectByName("stlMesh")?.parent;
    if (!group || originalDimensions.x === 0) return;

    const newScaleX = targetDimensions.width / originalDimensions.x;
    const newScaleY = targetDimensions.height / originalDimensions.y;
    const newScaleZ = targetDimensions.depth / originalDimensions.z;

    group.scale.set(newScaleX, newScaleY, newScaleZ);
    setCurrentScale({ x: newScaleX, y: newScaleY, z: newScaleZ });
    
    // Reset slicing when scale changes
    setSlicingParams(p => ({ ...p, currentLayerIndex: 0 }));
    setShowMiddleSlice(false);

  }, [targetDimensions, originalDimensions]);


  // --- Model and Slices Visibility ---
  useEffect(() => {
    if (!sceneRef.current) return;
    const outline = sceneRef.current.getObjectByName("modelOutline");
    if (outline) outline.visible = showModelOutline;

    sceneRef.current.children.filter(c => c.name === 'sliceLine').forEach(line => {
      line.visible = slicingParams.showSlices;
    });
  }, [showModelOutline, slicingParams.showSlices]);
  
  
  // --- Send Slicing Request to Worker ---
  useEffect(() => {
    if (!geometry || !workerInstanceRef.current) return;

    clearSlices(sceneRef.current);
      
    let sliceValueToRender = null;
    let showSlicesForWorker = debouncedSlicingParams.showSlices;

    if (showMiddleSlice && geometry.boundingBox) {
      const bboxMin = getScaledMinRangeValue(geometry, debouncedSlicingParams.slicingPlane, currentScale);
      const bboxMax = getScaledMaxRangeValue(geometry, debouncedSlicingParams.slicingPlane, currentScale);
      sliceValueToRender = (bboxMin + bboxMax) / 2;
      showSlicesForWorker = true;
    } else if (debouncedSlicingParams.singleSliceMode) {
      sliceValueToRender = debouncedSlicingParams.currentSliceValue;
    }

    if (showSlicesForWorker) {
      workerInstanceRef.current.postMessage({
        type: 'sliceModel',
        payload: {
          positionArray: geometry.attributes.position.array,
          bboxData: { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() },
          sliceHeight: debouncedSlicingParams.sliceHeight,
          currentSlice: sliceValueToRender,
          slicingPlane: debouncedSlicingParams.slicingPlane,
          scale: currentScale,
        }
      });
    }
  }, [debouncedSlicingParams, geometry, showMiddleSlice, currentScale]);

  // --- Export Functions ---
  const exportSVG = () => { /* ... unchanged ... */ };
  const exportDXF = () => { /* ... unchanged ... */ };

  // --- Calculated Values for UI ---
  const minRangeValue = getScaledMinRangeValue(geometry, slicingParams.slicingPlane, currentScale);
  const maxRangeValue = getScaledMaxRangeValue(geometry, slicingParams.slicingPlane, currentScale);
  const range = maxRangeValue - minRangeValue;
  const totalLayers = range > 0 && slicingParams.sliceHeight > 0 ? Math.floor(range / slicingParams.sliceHeight) + 1 : 0;
  
  const currentLayerIndex = Math.max(0, Math.min(totalLayers > 0 ? totalLayers - 1 : 0, slicingParams.currentLayerIndex));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden' }}>
      <div style={{ padding: 10, background: '#282c34', color: 'white', borderBottom: '1px solid #444', zIndex: 10, display: 'flex', flexWrap: 'wrap', gap: '10px 20px', alignItems: 'center' }}>
        {/* --- Controls --- */}
        <label>
          Slice Height:
          <input type="number" step="0.1" min="0.1" value={slicingParams.sliceHeight} onChange={handleSliceHeightChange} style={{ marginLeft: 5, width: 60 }}/>
        </label>
        <label>
          Plane:
          <select value={slicingParams.slicingPlane} onChange={handlePlaneChange} style={{ marginLeft: 5 }}>
            <option value="Z">Z</option>
            <option value="X">X</option>
            <option value="Y">Y</option>
          </select>
        </label>
        <label><input type="checkbox" checked={slicingParams.showSlices} onChange={handleToggleSlices}/>Show Slices</label>
        <label><input type="checkbox" checked={showModelOutline} onChange={handleToggleModelOutline}/>Show Outline</label>
        <label><input type="checkbox" checked={showMiddleSlice} onChange={handleToggleMiddleSlice}/>Middle Slice</label>
        <label><input type="checkbox" checked={slicingParams.singleSliceMode} onChange={handleToggleSingleSliceMode} disabled={showMiddleSlice}/>Single Slice</label>

        <label style={{ opacity: slicingParams.singleSliceMode && !showMiddleSlice ? 1 : 0.5 }}>
          Layer:
          <input
            type="range"
            min={0}
            max={totalLayers > 0 ? totalLayers - 1 : 0}
            step="1"
            value={currentLayerIndex}
            onChange={handleStepChange}
            disabled={!slicingParams.singleSliceMode || totalLayers <= 1 || showMiddleSlice}
            style={{ marginLeft: 5, width: 150, verticalAlign: 'middle' }}
          />
          <span style={{ marginLeft: 5 }}>{slicingParams.currentSliceValue.toFixed(2)}</span>
        </label>
        
        {/* --- Dimensions --- */}
        <label>
            Width:
            <input type="number" step="0.1" min="0" value={targetDimensions.width} onChange={handleTargetDimensionChange('width')} style={{ marginLeft: 5, width: 80 }}/>
        </label>
        <label>
            Height:
            <input type="number" step="0.1" min="0" value={targetDimensions.height} onChange={handleTargetDimensionChange('height')} style={{ marginLeft: 5, width: 80 }}/>
        </label>
        <label>
            Depth:
            <input type="number" step="0.1" min="0" value={targetDimensions.depth} onChange={handleTargetDimensionChange('depth')} style={{ marginLeft: 5, width: 80 }}/>
        </label>

        {geometry && (
            <span style={{ fontSize: '0.9em' }}>
                Layers: {totalLayers} | Dimensions (mm): W: {targetDimensions.width.toFixed(2)} H: {targetDimensions.height.toFixed(2)} D: {targetDimensions.depth.toFixed(2)}
            </span>
        )}

        <button onClick={exportSVG} style={{ marginLeft: 'auto' }}>Export SVG</button>
        <button onClick={exportDXF}>Export DXF</button>
      </div>
      <div ref={mountRef} style={{ width: "100%", height: "calc(100vh - 70px)" }} />
    </div>
  );
};

export default STLViewer;
