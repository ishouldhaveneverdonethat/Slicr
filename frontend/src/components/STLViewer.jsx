import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from "file-saver";

const STLViewer = ({ stlFile }) => {
  // --- 1. Model and Geometry State ---
  const mountRef = useRef(null);
  const [sceneState, setSceneState] = useState({ scene: null, renderer: null, camera: null });
  const [geometry, setGeometry] = useState(null);

  // --- 3. Slicing Logic State ---
  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 2,
    showSlices: true,
    currentSlice: 0,
    stepThrough: false, // Renamed from 'stepThrough' to 'singleSliceMode' for clarity
    slicingPlane: "Z",
  });

  // --- 4. UI Controls Handlers ---
  const handleSliceHeightChange = (e) => {
    setSlicingParams((p) => ({ ...p, sliceHeight: parseFloat(e.target.value) }));
  };

  const handlePlaneChange = (e) => {
    setSlicingParams((p) => ({ ...p, slicingPlane: e.target.value }));
  };

  const handleToggleSlices = () => {
    setSlicingParams((p) => ({ ...p, showSlices: !p.showSlices }));
  };

  const handleStepChange = (e) => {
    // When the slider is moved, activate singleSliceMode and update currentSlice
    setSlicingParams((p) => ({
      ...p,
      currentSlice: parseFloat(e.target.value),
      stepThrough: true, // Ensure singleSliceMode is true
    }));
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

    // Animate
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update(); // Only needed if damping is enabled
      renderer.render(scene, camera);
    };
    animate();

    // Save to state
    setSceneState({ scene, renderer, camera });

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      controls.dispose(); // Dispose controls
      renderer.dispose(); // Dispose renderer resources
      // Do NOT remove mount.removeChild(renderer.domElement) here, it's already done by the while loop above
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
        existing.geometry.dispose(); // Dispose old geometry
        existing.material.dispose(); // Dispose old material
      }
      scene.add(mesh);

      // Reset camera position to view the new model
      const size = new THREE.Vector3();
      loadedGeometry.boundingBox.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = sceneState.camera.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
      cameraZ *= 1.5; // Add some padding
      sceneState.camera.position.set(0, 0, cameraZ);
      sceneState.camera.lookAt(0, 0, 0); // Look at the center of the scene
      if (sceneState.controls) sceneState.controls.target.set(0, 0, 0); // Update controls target

      // Clear previous slices & add new if enabled
      clearSlices(scene);
      if (slicingParams.showSlices) {
        // Debounce slicing if performance is an issue with rapid param changes
        // For now, call directly
        sliceSTL(
          loadedGeometry,
          scene,
          slicingParams.sliceHeight,
          slicingParams.stepThrough ? slicingParams.currentSlice : null,
          slicingParams.slicingPlane
        );
      }
    },
    undefined, // onProgress callback - can be used for loading indicators
    (error) => {
      console.error("Error loading STL file:", error);
      alert("Error loading STL file. Please check the file and try again.");
    });
  }, [stlFile, sceneState.scene, sceneState.camera, slicingParams]); // Added sceneState.camera to dependencies

  // --- Re-slice when slicingParams change (if geometry exists) ---
  useEffect(() => {
    if (geometry && sceneState.scene && slicingParams.showSlices) {
      clearSlices(sceneState.scene);
      sliceSTL(
        geometry,
        sceneState.scene,
        slicingParams.sliceHeight,
        slicingParams.stepThrough ? slicingParams.currentSlice : null,
        slicingParams.slicingPlane
      );
    } else if (geometry && sceneState.scene && !slicingParams.showSlices) {
      clearSlices(sceneState.scene); // Clear if showSlices is turned off
    }
  }, [slicingParams, geometry, sceneState.scene]); // Depend on slicingParams and geometry

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

  // --- 3. Slicing Logic (The core area that needs robust improvement) ---
  const sliceSTL = (geometry, scene, heightStep, currentSliceVal, plane) => {
    const pos = geometry.attributes.position;
    const bbox = geometry.boundingBox;

    if (!bbox) {
      console.warn("Bounding box not computed for geometry. Cannot slice.");
      return;
    }

    let axis, min, max;
    // Ensure axis mapping is correct for BufferAttribute access
    let axisIndex; // 0 for X, 1 for Y, 2 for Z
    if (plane === "Z") {
      axis = "z";
      axisIndex = 2;
      min = bbox.min.z;
      max = bbox.max.z;
    } else if (plane === "X") {
      axis = "x";
      axisIndex = 0;
      min = bbox.min.x;
      max = bbox.max.x;
    } else {
      axis = "y";
      axisIndex = 1;
      min = bbox.min.y;
      max = bbox.max.y;
    }

    // Determine slice values
    const valuesToSlice =
      currentSliceVal !== null
        ? [currentSliceVal]
        : Array.from({ length: Math.floor((max - min) / heightStep) + 1 }, (_, i) => min + i * heightStep);

    // Temporary vectors to avoid repeated allocations in loop
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const p3 = new THREE.Vector3();

    valuesToSlice.forEach((value) => {
      const intersectionPointsForThisSlice = []; // Points found for the current slice plane

      for (let i = 0; i < pos.count; i += 3) {
        // Read triangle vertices
        p1.fromBufferAttribute(pos, i);
        p2.fromBufferAttribute(pos, i + 1);
        p3.fromBufferAttribute(pos, i + 2);

        const triangle = [p1, p2, p3];
        const currentTriangleIntersectionPoints = [];

        for (let j = 0; j < 3; j++) {
          const v1 = triangle[j];
          const v2 = triangle[(j + 1) % 3];

          // Check if segment (v1, v2) crosses the plane 'value' along 'axis'
          // Using a small epsilon to handle floating point comparisons near the plane
          const epsilon = 1e-6; // A small tolerance
          const val1 = v1[axis];
          const val2 = v2[axis];

          // Determine if intersection occurs
          if (
            (val1 <= value + epsilon && val2 >= value - epsilon) ||
            (val2 <= value + epsilon && val1 >= value - epsilon)
          ) {
            // Avoid division by zero for horizontal/co-planar edges
            if (Math.abs(val2 - val1) < epsilon) {
              // Edge is essentially co-planar with slice; ignore for now or handle specifically
              continue;
            }

            // Calculate intersection point
            const t = (value - val1) / (val2 - val1);
            const intersectPoint = new THREE.Vector3().lerpVectors(v1, v2, t);
            currentTriangleIntersectionPoints.push(intersectPoint);
          }
        }

        // A slice plane will intersect a triangle in either 0 or 2 points (forming a line segment)
        // or 1 point (if it passes through a vertex), or 3 points (if co-planar).
        if (currentTriangleIntersectionPoints.length === 2) {
          // If we found two intersection points for this triangle, they form a segment on the slice plane.
          intersectionPointsForThisSlice.push(currentTriangleIntersectionPoints[0], currentTriangleIntersectionPoints[1]);
        }
        // Cases like 0 or 1 point mean no intersection or passing through a vertex.
        // Cases with >2 points (co-planar triangle) are complex and not handled by this simple loop.
      }

      // --- THIS IS THE CRITICAL SECTION FOR "GARBLED" SLICES ---
      // The `intersectionPointsForThisSlice` array now contains pairs of points from *all*
      // triangles that intersect the current slice plane.
      // Your current sorting approach (angle around centroid) works only for simple, convex,
      // single-contour slices. It will fail for:
      // - Models with holes
      // - Models that produce multiple disconnected contours on a single slice (e.g., a "U" shape sliced in the middle)
      // - Self-intersecting contours

      // For a robust solution, you need to:
      // 1. Convert the pairs of points (segments) into a data structure that allows easy traversal (e.g., an adjacency list).
      // 2. Traverse this structure to find all distinct, closed loops (contours).
      // 3. Handle nesting (inner vs. outer loops for holes).
      // This typically requires a 2D computational geometry library (like js-clipper) or a much more complex custom algorithm.

      if (intersectionPointsForThisSlice.length > 1) {
        // --- START: Simple Angle Sort (Produces Garbled Results for Complex Shapes) ---
        // This part is the reason for garbling. It assumes all points belong to a single,
        // non-self-intersecting contour that can be sorted by angle.
        const centroid = intersectionPointsForThisSlice
          .reduce((acc, p) => acc.add(p.clone()), new THREE.Vector3())
          .divideScalar(intersectionPointsForThisSlice.length);

        // Sort points by angle around centroid on the relevant plane
        // Project to 2D for sorting to ensure correct angle calculation regardless of slicing plane
        intersectionPointsForThisSlice.sort((a, b) => {
          let angleA, angleB;
          if (plane === "Z") { // Project to XY plane
            angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
            angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
          } else if (plane === "X") { // Project to YZ plane
            angleA = Math.atan2(a.z - centroid.z, a.y - centroid.y);
            angleB = Math.atan2(b.z - centroid.z, b.y - centroid.y);
          } else { // Project to XZ plane
            angleA = Math.atan2(a.z - centroid.z, a.x - centroid.x);
            angleB = Math.atan2(b.z - centroid.z, b.x - centroid.x);
          }
          return angleA - angleB;
        });

        const sliceGeometry = new THREE.BufferGeometry().setFromPoints(
          intersectionPointsForThisSlice.concat(intersectionPointsForThisSlice[0]) // Close the loop
        );
        const sliceMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const sliceLine = new THREE.LineLoop(sliceGeometry, sliceMaterial);
        sliceLine.name = "sliceLine";
        scene.add(sliceLine);
        // --- END: Simple Angle Sort ---

        // --- PLACEHOLDER FOR ROBUST CONTOUR RECONSTRUCTION ---
        // A truly robust solution would go here, replacing the angle sort above.
        // It would involve:
        // 1. Creating a list of 2D line segments from `intersectionPointsForThisSlice`.
        //    (e.g., pairs (intersectionPointsForThisSlice[0], intersectionPointsForThisSlice[1]),
        //    then (intersectionPointsForThisSlice[2], intersectionPointsForThisSlice[3]), etc.)
        // 2. Using a library like js-clipper to perform polygon union/reconstruction on these segments.
        // 3. Iterating through the resulting closed 2D polygons from the library.
        // 4. For each 2D polygon, convert its points back to 3D at the current `value` (sliceZ/sliceY/sliceX).
        // 5. Create a `THREE.LineLoop` for each *correctly reconstructed* contour and add to scene.
      }
    });
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
        const y = pos.getY(i); // For Z-slice, Y from Three.js is Y in SVG
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

    const viewBoxX = minX;
    const viewBoxY = -maxY; // Invert maxY for SVG's Y-axis
    const viewBoxWidth = maxX - minX;
    const viewBoxHeight = maxY - minY;

    const svgContent = `<?xml version="1.0" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="${viewBoxX.toFixed(3)} ${viewBoxY.toFixed(3)} ${viewBoxWidth.toFixed(3)} ${viewBoxHeight.toFixed(3)}">
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
          dx1 = p1x; dy1 = p1z; dz1 = 0; // When slicing on Y, X and Z form the 2D plane
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
          Single Slice Mode:
          <input
            type="range"
            min={geometry && geometry.boundingBox ? geometry.boundingBox.min[slicingParams.slicingPlane.toLowerCase()].toFixed(2) : 0}
            max={geometry && geometry.boundingBox ? geometry.boundingBox.max[slicingParams.slicingPlane.toLowerCase()].toFixed(2) : 100}
            step="0.1"
            value={slicingParams.currentSlice}
            onChange={handleStepChange}
            disabled={!geometry}
            style={{ marginLeft: 5, width: 150 }}
          />
          <span style={{ marginLeft: 5 }}>{slicingParams.currentSlice.toFixed(2)}</span>
        </label>

        <button onClick={exportSVG} style={{ marginLeft: 20, padding: '5px 10px', cursor: 'pointer' }}>
          Export SVG
        </button>
        <button onClick={exportDXF} style={{ marginLeft: 10, padding: '5px 10px', cursor: 'pointer' }}>
          Export DXF
        </button>
      </div>
      <div ref={mountRef} style={{ width: "100%", height: "calc(100vh - 50px)" }} /> {/* Adjust height based on controls */}
    </div>
  );
};

export default STLViewer;
