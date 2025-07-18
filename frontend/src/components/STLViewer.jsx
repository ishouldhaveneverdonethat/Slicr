import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from "file-saver";

const STLViewer = ({ stlFile }) => {
  // --- 1. Model and Geometry State ---
  const mountRef = useRef(null);
  // Added controls to state to ensure they are accessible for cleanup and updates
  const [sceneState, setSceneState] = useState({ scene: null, renderer: null, camera: null, controls: null });
  const [geometry, setGeometry] = useState(null);

  // --- 3. Slicing Logic State ---
  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 2,
    showSlices: true,
    currentSlice: 0,
    singleSliceMode: false, // Renamed for clarity and explicitly managed
    slicingPlane: "Z",
    slicingDisplayMode: 'rawSegments', // 'rawSegments' or 'angleSortedContours'
  });

  // --- 4. UI Controls Handlers ---
  const handleSliceHeightChange = (e) => {
    setSlicingParams((p) => ({
      ...p,
      sliceHeight: parseFloat(e.target.value),
      singleSliceMode: false, // Turn off single slice mode when slice height is changed
    }));
  };

  const handlePlaneChange = (e) => {
    setSlicingParams((p) => ({
      ...p,
      slicingPlane: e.target.value,
      singleSliceMode: false, // Reset single slice mode when plane changes
    }));
  };

  const handleToggleSlices = () => {
    setSlicingParams((p) => ({ ...p, showSlices: !p.showSlices }));
  };

  const handleStepChange = (e) => {
    // When the slider is moved, activate singleSliceMode and update currentSlice
    setSlicingParams((p) => ({
      ...p,
      currentSlice: parseFloat(e.target.value),
      singleSliceMode: true, // Ensure singleSliceMode is true when slider is used
      showSlices: true, // Ensure slices are shown when stepping
    }));
  };

  const handleToggleSingleSliceMode = () => {
    setSlicingParams((p) => ({
      ...p,
      singleSliceMode: !p.singleSliceMode,
      // When turning off single slice mode, it will naturally revert to showing all slices
      // based on sliceHeight due to the useEffect dependency.
    }));
  };

  const handleDisplayModeChange = (e) => {
    setSlicingParams((p) => ({ ...p, slicingDisplayMode: e.target.value }));
  };


  // --- 2. Scene Setup and Render ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Clear previous canvas if any (important for hot-reloading or re-mounting)
    while (mount.firstChild) {
      mount.removeChild(mount.firstChild);
    }

    // Scene, camera, renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a); // Slightly darker background

    const camera = new THREE.PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio); // Improve rendering quality on high-DPI screens
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // Smoother controls
    controls.dampingFactor = 0.05;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 50, 100).normalize();
    scene.add(directionalLight);

    // Handle window resize
    const handleResize = () => {
      if (mount) {
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      }
    };
    window.addEventListener("resize", handleResize);

    // Animate loop
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update(); // Only needed if damping is enabled
      renderer.render(scene, camera);
    };
    animate();

    // Save scene, renderer, camera, and controls to state
    setSceneState({ scene, renderer, camera, controls });

    // Cleanup function
    return () => {
      window.removeEventListener("resize", handleResize);
      controls.dispose(); // Dispose controls
      renderer.dispose(); // Dispose renderer resources
      // Note: mount.removeChild(renderer.domElement) is handled by the initial while loop when component remounts
    };
  }, []); // Empty dependency array means this runs once on mount

  // --- 1. STL Loader & Mesh Setup ---
  useEffect(() => {
    if (!sceneState.scene || !stlFile) return;

    const loader = new STLLoader();
    loader.load(stlFile, (loadedGeometry) => {
      loadedGeometry.computeBoundingBox();
      setGeometry(loadedGeometry); // Store geometry in state for UI controls

      const material = new THREE.MeshPhongMaterial({ color: 0x00aaff });
      const mesh = new THREE.Mesh(loadedGeometry, material);

      // Center mesh
      const center = new THREE.Vector3();
      loadedGeometry.boundingBox.getCenter(center);
      mesh.position.sub(center);
      mesh.name = "stlMesh";

      // Replace existing mesh
      const scene = sceneState.scene;
      const existing = scene.getObjectByName("stlMesh");
      if (existing) {
        scene.remove(existing);
        if (existing.geometry) existing.geometry.dispose(); // Dispose old geometry
        if (existing.material) existing.material.dispose(); // Dispose old material
      }
      scene.add(mesh);

      // Reset camera position to view the new model
      if (sceneState.camera && sceneState.controls) {
        const size = new THREE.Vector3();
        loadedGeometry.boundingBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = sceneState.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5; // Add some padding
        // Position camera relative to the model's center
        sceneState.camera.position.set(center.x, center.y, center.z + cameraZ);
        sceneState.camera.lookAt(center); // Look at the model center
        sceneState.controls.target.copy(center); // Update controls target to model center
        sceneState.controls.update(); // Update controls after changing target
      }

      // Initial slicing (or clearing if showSlices is false)
      clearSlices(scene); // Always clear previous slices
      if (slicingParams.showSlices) {
         let sliceValueToRender = null;
         if (slicingParams.singleSliceMode) {
           sliceValueToRender = slicingParams.currentSlice;
         }
         // Call getSliceSegments, then render based on display mode
         const segments = getSliceSegments(
           loadedGeometry,
           slicingParams.sliceHeight,
           sliceValueToRender,
           slicingParams.slicingPlane
         );
         renderSlices(segments, scene, slicingParams.slicingDisplayMode, slicingParams.slicingPlane);
      }
    },
    undefined, // onProgress callback - can be used for loading indicators
    (error) => {
      console.error("Error loading STL file:", error);
      alert("Error loading STL file. Please check the file and try again.");
    });
  }, [stlFile, sceneState.scene, sceneState.camera, sceneState.controls, slicingParams.singleSliceMode, slicingParams.currentSlice, slicingParams.sliceHeight, slicingParams.slicingPlane, slicingParams.showSlices, slicingParams.slicingDisplayMode]); // Added new dependency

  // --- Re-slice when slicingParams change (if geometry exists) ---
  useEffect(() => {
    if (geometry && sceneState.scene) {
      clearSlices(sceneState.scene);
      if (slicingParams.showSlices) {
        let sliceValueToRender = null;
        if (slicingParams.singleSliceMode) {
          sliceValueToRender = slicingParams.currentSlice;
        }
        // Call getSliceSegments, then render based on display mode
        const segments = getSliceSegments(
          geometry,
          slicingParams.sliceHeight,
          sliceValueToRender,
          slicingParams.slicingPlane
        );
        renderSlices(segments, sceneState.scene, slicingParams.slicingDisplayMode, slicingParams.slicingPlane);
      }
    }
  }, [slicingParams.sliceHeight, slicingParams.showSlices, slicingParams.currentSlice, slicingParams.singleSliceMode, slicingParams.slicingPlane, slicingParams.slicingDisplayMode, geometry, sceneState.scene]); // Added new dependency

  // --- 6. Utility Functions ---
  const clearSlices = (scene) => {
    // Remove slices by name, and dispose their geometry and material
    const slices = scene.children.filter((child) => child.name === "sliceLine");
    slices.forEach((line) => {
      scene.remove(line);
      if (line.geometry) line.geometry.dispose();
      if (line.material) line.material.dispose();
    });
  };

  /**
   * getSliceSegments
   * Extracts raw intersection points (segments) for each slice plane.
   * This function focuses only on finding the intersections, not on contour reconstruction.
   * @param {THREE.BufferGeometry} geometry The geometry to slice.
   * @param {number} heightStep The height between slices.
   * @param {number | null} currentSliceVal If not null, only slice at this specific value.
   * @param {'X' | 'Y' | 'Z'} plane The slicing plane (e.g., 'Z' for XY slices).
   * @returns {Array<Array<THREE.Vector3>>} An array of arrays, where each inner array is [point1, point2] forming a segment.
   */
  const getSliceSegments = (geometry, heightStep, currentSliceVal, plane) => {
    const pos = geometry.attributes.position;
    const bbox = geometry.boundingBox;
    const allSliceSegments = []; // Will store segments for all slices

    if (!bbox) {
      console.warn("Bounding box not computed for geometry. Cannot slice.");
      return allSliceSegments;
    }

    let axis;
    let min, max;
    if (plane === "Z") {
      axis = "z";
      min = bbox.min.z;
      max = bbox.max.z;
    } else if (plane === "X") {
      axis = "x";
      min = bbox.min.x;
      max = bbox.max.x;
    } else { // Y plane
      axis = "y";
      min = bbox.min.y;
      max = bbox.max.y;
    }

    const valuesToSlice =
      currentSliceVal !== null
        ? [currentSliceVal]
        : Array.from({ length: Math.floor((max - min) / heightStep) + 1 }, (_, i) => min + i * heightStep);

    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const p3 = new THREE.Vector3();

    valuesToSlice.forEach((value) => {
      const segmentsForCurrentSlice = []; // Segments for this specific slice plane

      for (let i = 0; i < pos.count; i += 3) {
        p1.fromBufferAttribute(pos, i);
        p2.fromBufferAttribute(pos, i + 1);
        p3.fromBufferAttribute(pos, i + 2);

        const triangle = [p1, p2, p3];
        const currentTriangleIntersectionPoints = [];

        for (let j = 0; j < 3; j++) {
          const v1 = triangle[j];
          const v2 = triangle[(j + 1) % 3];

          const epsilon = 1e-6;
          const val1 = v1[axis];
          const val2 = v2[axis];

          if (
            (val1 <= value + epsilon && val2 >= value - epsilon) ||
            (val2 <= value + epsilon && val1 >= value - epsilon)
          ) {
            if (Math.abs(val2 - val1) < epsilon) {
              continue;
            }

            const t = (value - val1) / (val2 - val1);
            const intersectPoint = new THREE.Vector3().lerpVectors(v1, v2, t);
            currentTriangleIntersectionPoints.push(intersectPoint);
          }
        }

        if (currentTriangleIntersectionPoints.length === 2) {
          // Store the two points that form a segment
          segmentsForCurrentSlice.push(currentTriangleIntersectionPoints);
        }
      }
      allSliceSegments.push(...segmentsForCurrentSlice); // Add segments of current slice to overall list
    });
    return allSliceSegments;
  };

  /**
   * renderSlices
   * Renders the slice segments based on the chosen display mode.
   * @param {Array<Array<THREE.Vector3>>} segments An array of segments, each segment is [point1, point2].
   * @param {THREE.Scene} scene The Three.js scene to add lines to.
   * @param {'rawSegments' | 'angleSortedContours'} displayMode The mode to render slices.
   * @param {'X' | 'Y' | 'Z'} plane The slicing plane, used for angle sorting projection.
   */
  const renderSlices = (segments, scene, displayMode, plane) => {
    if (displayMode === 'rawSegments') {
      segments.forEach(segment => {
        const segmentGeometry = new THREE.BufferGeometry().setFromPoints(segment);
        const segmentMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const line = new THREE.LineSegments(segmentGeometry, segmentMaterial);
        line.name = "sliceLine";
        scene.add(line);
      });
    } else { // 'angleSortedContours' mode (attempts to form contours)
      // This part still uses the angle sort and will produce "garbled" results for complex shapes.
      // It's here to demonstrate the difference and the limitations of this approach.

      // Collect all points from all segments for this (single or multiple) slice(s)
      const allPointsForContouring = [];
      segments.forEach(segment => {
        allPointsForContouring.push(segment[0], segment[1]);
      });

      if (allPointsForContouring.length > 1) {
        const centroid = allPointsForContouring
          .reduce((acc, p) => acc.add(p.clone()), new THREE.Vector3())
          .divideScalar(allPointsForContouring.length);

        allPointsForContouring.sort((a, b) => {
          let angleA, angleB;
          if (plane === "Z") { // Project to XY plane
            angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
            angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
          } else if (plane === "X") { // Project to YZ plane
            angleA = Math.atan2(a.z - centroid.z, a.y - centroid.y);
            angleB = Math.atan2(b.z - centroid.z, b.y - centroid.y);
          } else { // Y plane
            angleA = Math.atan2(a.z - centroid.z, a.x - centroid.x);
            angleB = Math.atan2(b.z - centroid.z, b.x - centroid.x);
          }
          return angleA - angleB;
        });

        const sliceGeometry = new THREE.BufferGeometry().setFromPoints(
          allPointsForContouring.concat(allPointsForContouring[0]) // Close the loop
        );
        const sliceMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const sliceLine = new THREE.LineLoop(sliceGeometry, sliceMaterial);
        sliceLine.name = "sliceLine";
        scene.add(sliceLine);
      }
    }
  };


  // --- 5. Export Functions ---
  const exportSVG = () => {
    if (!sceneState.scene) return;
    const lines = sceneState.scene.children.filter((child) => child.name === "sliceLine");
    if (lines.length === 0) return alert("No slices to export.");

    // Determine overall bounding box of the slice lines for SVG viewBox
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    let svgPaths = "";
    lines.forEach((line) => {
      const pos = line.geometry.attributes.position;
      let pathD = "";
      for (let i = 0; i < pos.count; i++) {
        // SVG Y-axis is inverted compared to Three.js convention
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);

        let px, py; // Projected X and Y for SVG
        // Project points based on the current slicing plane for SVG export
        if (slicingParams.slicingPlane === "Z") {
          px = x;
          py = y;
        } else if (slicingParams.slicingPlane === "X") {
          px = z; // When slicing on X, Y and Z form the 2D plane
          py = y;
        } else { // Y plane
          px = x;
          py = z; // When slicing on Y, X and Z form the 2D plane
        }

        // Update SVG bounds
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);

        // SVG Y-axis is typically inverted, so we'll invert py
        pathD += i === 0 ? `M ${px.toFixed(3)} ${(-py).toFixed(3)}` : ` L ${px.toFixed(3)} ${(-py).toFixed(3)}`;
      }
      pathD += " Z"; // close path

      svgPaths += `<path d="${pathD}" stroke="red" stroke-width="0.05" fill="none"/>`;
    });

    // Calculate the viewBox string separately to avoid complex inline expression
    const viewBoxString = `${minX.toFixed(3)} ${(-maxY).toFixed(3)} ${(maxX - minX).toFixed(3)} ${(maxY - minY).toFixed(3)}`;

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
    if (lines.length === 0) return alert("No slices to export.");

    let dxfContent = "0\nSECTION\n2\nENTITIES\n";
    lines.forEach((line) => {
      const pos = line.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        // Get current point
        const p1x = pos.getX(i);
        const p1y = pos.getY(i);
        const p1z = pos.getZ(i);

        // Get next point (wraps around for LineLoop)
        const nextIndex = (i + 1) % pos.count;
        const p2x = pos.getX(nextIndex);
        const p2y = pos.getY(nextIndex);
        const p2z = pos.getZ(nextIndex);

        let dx1, dy1, dz1;
        let dx2, dy2, dz2;

        // Project points based on the current slicing plane for DXF export
        if (slicingParams.slicingPlane === "Z") {
          dx1 = p1x; dy1 = p1y; dz1 = 0; // DXF 2D lines typically have Z=0
          dx2 = p2x; dy2 = p2y; dz2 = 0;
        } else if (slicingParams.slicingPlane === "X") {
          dx1 = p1z; dy1 = p1y; dz1 = 0; // When slicing on X, Y and Z form the 2D plane
          dx2 = p2z; dy2 = p2y; dz2 = 0;
        } else { // Y plane
          dx1 = p1x; dy1 = p1z; dz1 = 0;
          dx2 = p2x; dy2 = p2z; dz2 = 0;
        }

        dxfContent +=
          `0\nLINE\n8\n0\n10\n${dx1.toFixed(3)}\n20\n${dy1.toFixed(3)}\n30\n${dz1.toFixed(3)}\n11\n${dx2.toFixed(3)}\n21\n${dy2.toFixed(3)}\n31\n${dz2.toFixed(3)}\n`;
      }
    });
    dxfContent += "0\nENDSEC\n0\nEOF";

    const blob = new Blob([dxfContent], { type: "application/dxf" });
    saveAs(blob, "slice.dxf");
  };

  // Calculate min/max for the slider (numerical values)
  const minRangeValue = geometry && geometry.boundingBox
    ? geometry.boundingBox.min[slicingParams.slicingPlane.toLowerCase()]
    : 0;

  const maxRangeValue = geometry && geometry.boundingBox
    ? geometry.boundingBox.max[slicingParams.slicingPlane.toLowerCase()]
    : 100;

  // Calculate total layers and current layer index for display
  let totalLayers = 0;
  let currentLayerIndex = 0;
  let modelDimensions = { x: 0, y: 0, z: 0 }; // For displaying dimensions

  if (geometry && geometry.boundingBox && slicingParams.sliceHeight > 0) {
    const range = maxRangeValue - minRangeValue;
    totalLayers = Math.floor(range / slicingParams.sliceHeight) + 1; // +1 because it's count, not index

    // Calculate current layer index based on currentSlice and sliceHeight
    // Ensure currentSlice is within the min/max range for calculation
    const clampedCurrentSlice = Math.max(minRangeValue, Math.min(maxRangeValue, slicingParams.currentSlice));
    currentLayerIndex = Math.floor((clampedCurrentSlice - minRangeValue) / slicingParams.sliceHeight);
    // Ensure index is within bounds [0, totalLayers - 1]
    currentLayerIndex = Math.max(0, Math.min(totalLayers - 1, currentLayerIndex));

    // Calculate model dimensions
    const size = new THREE.Vector3();
    geometry.boundingBox.getSize(size);
    modelDimensions = {
      x: size.x.toFixed(2),
      y: size.y.toFixed(2),
      z: size.z.toFixed(2),
    };
  }

  // --- UI Render ---
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
            style={{ marginRight: 5 }}
          />
          Single Slice Mode
        </label>

        <label style={{ marginLeft: 10, opacity: slicingParams.singleSliceMode ? 1 : 0.5 }}>
          Slice Position:
          <input
            type="range"
            min={minRangeValue}
            max={maxRangeValue}
            step="0.1"
            value={slicingParams.currentSlice}
            onChange={handleStepChange}
            disabled={!geometry || !slicingParams.singleSliceMode}
            style={{ marginLeft: 5, width: 150 }}
          />
          <span style={{ marginLeft: 5 }}>{slicingParams.currentSlice.toFixed(2)}</span>
        </label>

        <label style={{ marginLeft: 20 }}>
          Display Mode:
          <select value={slicingParams.slicingDisplayMode} onChange={handleDisplayModeChange} style={{ marginLeft: 5, padding: 3 }}>
            <option value="rawSegments">Raw Segments</option>
            <option value="angleSortedContours">Angle Sorted Contours (may be garbled)</option>
          </select>
        </label>


        {geometry && ( // Only show layer and dimension info if a geometry is loaded
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
