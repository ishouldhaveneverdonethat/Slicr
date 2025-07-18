import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from "file-saver";

const STLViewer = ({ stlFile }) => {
  // --- 1. Model and Geometry State ---
  const mountRef = useRef(null);
  const [sceneState, setSceneState] = useState({ scene: null, renderer: null, camera: null, controls: null }); // Added controls to state
  const [geometry, setGeometry] = useState(null);

  // --- 3. Slicing Logic State ---
  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 2,
    showSlices: true,
    currentSlice: 0,
    singleSliceMode: false, // Renamed for clarity and explicitly managed
    slicingPlane: "Z",
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
      // When turning off single slice mode, ensure currentSlice is reset if desired,
      // or just let it naturally show all slices based on sliceHeight.
      // For now, it will simply revert to showing all slices if singleSliceMode is false.
    }));
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

    // Save controls to state as well
    setSceneState({ scene, renderer, camera, controls });

    return () => {
      window.removeEventListener("resize", handleResize);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // --- 1. STL Loader & Mesh Setup ---
  useEffect(() => {
    if (!sceneState.scene || !stlFile) return;

    const loader = new STLLoader();
    loader.load(stlFile, (loadedGeometry) => {
      loadedGeometry.computeBoundingBox();
      setGeometry(loadedGeometry);

      const material = new THREE.MeshPhongMaterial({ color: 0x00aaff });
      const mesh = new THREE.Mesh(loadedGeometry, material);

      const center = new THREE.Vector3();
      loadedGeometry.boundingBox.getCenter(center);
      mesh.position.sub(center);
      mesh.name = "stlMesh";

      const scene = sceneState.scene;
      const existing = scene.getObjectByName("stlMesh");
      if (existing) {
        scene.remove(existing);
        if (existing.geometry) existing.geometry.dispose();
        if (existing.material) existing.material.dispose();
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
        sceneState.camera.position.set(center.x, center.y, center.z + cameraZ); // Position relative to model center
        sceneState.camera.lookAt(center); // Look at the model center
        sceneState.controls.target.copy(center); // Update controls target to model center
        sceneState.controls.update();
      }

      // Initial slicing (or clearing if showSlices is false)
      clearSlices(scene); // Always clear previous slices
      if (slicingParams.showSlices) {
         let sliceValueToRender = null;
         if (slicingParams.singleSliceMode) {
           sliceValueToRender = slicingParams.currentSlice;
         }
         sliceSTL(
           loadedGeometry,
           scene,
           slicingParams.sliceHeight,
           sliceValueToRender,
           slicingParams.slicingPlane
         );
      }
    },
    undefined,
    (error) => {
      console.error("Error loading STL file:", error);
      alert("Error loading STL file. Please check the file and try again.");
    });
  }, [stlFile, sceneState.scene, sceneState.camera, sceneState.controls, slicingParams.singleSliceMode, slicingParams.currentSlice, slicingParams.sliceHeight, slicingParams.slicingPlane, slicingParams.showSlices]); // Added more dependencies here to ensure consistent behavior

  // --- Re-slice when slicingParams change (if geometry exists) ---
  useEffect(() => {
    if (geometry && sceneState.scene) {
      clearSlices(sceneState.scene);
      if (slicingParams.showSlices) {
        let sliceValueToRender = null;
        if (slicingParams.singleSliceMode) { // THIS IS THE KEY CHANGE
          sliceValueToRender = slicingParams.currentSlice;
        }
        sliceSTL(
          geometry,
          sceneState.scene,
          slicingParams.sliceHeight,
          sliceValueToRender, // Pass the determined slice value
          slicingParams.slicingPlane
        );
      }
    }
  }, [slicingParams.sliceHeight, slicingParams.showSlices, slicingParams.currentSlice, slicingParams.singleSliceMode, slicingParams.slicingPlane, geometry, sceneState.scene]);

  // --- 6. Utility Functions ---
  const clearSlices = (scene) => {
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
      currentSliceVal !== null // If currentSliceVal is provided (single slice mode)
        ? [currentSliceVal] // Only slice at that specific value
        : Array.from({ length: Math.floor((max - min) / heightStep) + 1 }, (_, i) => min + i * heightStep); // Otherwise, generate multiple slices

    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const p3 = new THREE.Vector3();

    valuesToSlice.forEach((value) => {
      const intersectionPointsForThisSlice = [];

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
          intersectionPointsForThisSlice.push(currentTriangleIntersectionPoints[0], currentTriangleIntersectionPoints[1]);
        }
      }

      if (intersectionPointsForThisSlice.length > 1) {
        // --- THIS IS THE CRITICAL SECTION FOR "GARBLED" SLICES ---
        // As discussed, this simple angle sort is not robust for complex contours.
        // It's the reason why slices look "garbled" for anything but simple convex shapes.
        // For a robust solution, consider a 2D computational geometry library like js-clipper.

        const centroid = intersectionPointsForThisSlice
          .reduce((acc, p) => acc.add(p.clone()), new THREE.Vector3())
          .divideScalar(intersectionPointsForThisSlice.length);

        intersectionPointsForThisSlice.sort((a, b) => {
          let angleA, angleB;
          if (plane === "Z") {
            angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
            angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
          } else if (plane === "X") {
            angleA = Math.atan2(a.z - centroid.z, a.y - centroid.y);
            angleB = Math.atan2(b.z - centroid.z, b.y - centroid.y);
          } else { // Y plane
            angleA = Math.atan2(a.z - centroid.z, a.x - centroid.x);
            angleB = Math.atan2(b.z - centroid.z, b.x - centroid.x);
          }
          return angleA - angleB;
        });

        const sliceGeometry = new THREE.BufferGeometry().setFromPoints(
          intersectionPointsForThisSlice.concat(intersectionPointsForThisSlice[0])
        );
        const sliceMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const sliceLine = new THREE.LineLoop(sliceGeometry, sliceMaterial);
        sliceLine.name = "sliceLine";
        scene.add(sliceLine);
      }
    });
  };

  // --- 5. Export Functions ---
  const exportSVG = () => {
    if (!sceneState.scene) return;
    const lines = sceneState.scene.children.filter((child) => child.name === "sliceLine");
    if (lines.length === 0) return alert("No slices to export.");

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    let svgPaths = "";
    lines.forEach((line) => {
      const pos = line.geometry.attributes.position;
      let pathD = "";
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);

        let px, py;
        if (slicingParams.slicingPlane === "Z") {
          px = x;
          py = y;
        } else if (slicingParams.slicingPlane === "X") {
          px = z;
          py = y;
        } else { // Y plane
          px = x;
          py = z;
        }

        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);

        pathD += i === 0 ? `M ${px.toFixed(3)} ${(-py).toFixed(3)}` : ` L ${px.toFixed(3)} ${(-py).toFixed(3)}`;
      }
      pathD += " Z";

      svgPaths += `<path d="${pathD}" stroke="red" stroke-width="0.05" fill="none"/>`;
    });

    const viewBoxX = minX;
    const viewBoxY = -maxY;
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
        const p1x = pos.getX(i);
        const p1y = pos.getY(i);
        const p1z = pos.getZ(i);

        const nextIndex = (i + 1) % pos.count;
        const p2x = pos.getX(nextIndex);
        const p2y = pos.getY(nextIndex);
        const p2z = pos.getZ(nextIndex);

        let dx1, dy1, dz1;
        let dx2, dy2, dz2;

        if (slicingParams.slicingPlane === "Z") {
          dx1 = p1x; dy1 = p1y; dz1 = 0;
          dx2 = p2x; dy2 = p2y; dz2 = 0;
        } else if (slicingParams.slicingPlane === "X") {
          dx1 = p1z; dy1 = p1y; dz1 = 0;
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
            min={geometry && geometry.boundingBox ? geometry.boundingBox.min[slicingParams.slicingPlane.toLowerCase()].toFixed(2) : 0}
            max={geometry && geometry.boundingBox ? geometry.boundingBox.max[slicingParams.slicingPlane.toLowerCase()].toFixed(2) : 100}
            step="0.1"
            value={slicingParams.currentSlice}
            onChange={handleStepChange}
            disabled={!geometry || !slicingParams.singleSliceMode} {/* Disable if no geometry or not in single slice mode */}
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
      <div ref={mountRef} style={{ width: "100%", height: "calc(100vh - 50px)" }} />
    </div>
  );
};

export default STLViewer;
