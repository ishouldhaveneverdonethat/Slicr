import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib";
import { saveAs } from "file-saver";
import * as ClipperLib from 'js-clipper';

const STLViewer = ({ stlFile }) => {
  // --- 1. Model and Geometry State ---
  const mountRef = useRef(null);
  const [sceneState, setSceneState] = useState({ scene: null, renderer: null, camera: null, controls: null });
  const [geometry, setGeometry] = useState(null);

  // --- 3. Slicing Logic State ---
  const [slicingParams, setSlicingParams] = useState({
    sliceHeight: 2,
    showSlices: true,
    currentSlice: 0,
    singleSliceMode: false,
    slicingPlane: "Z",
  });

  // --- Debounce state for slicing ---
  const [debouncedSlicingParams, setDebouncedSlicingParams] = useState(slicingParams);

  // Custom debounce hook (or simple implementation directly in useEffect)
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
    }));
  };

  const handlePlaneChange = (e) => {
    setSlicingParams((p) => ({
      ...p,
      slicingPlane: e.target.value,
      singleSliceMode: false,
    }));
  };

  const handleToggleSlices = () => {
    setSlicingParams((p) => ({ ...p, showSlices: !p.showSlices }));
  };

  const handleStepChange = (e) => {
    setSlicingParams((p) => ({
      ...p,
      currentSlice: parseFloat(e.target.value),
      singleSliceMode: true,
      showSlices: true,
    }));
  };

  const handleToggleSingleSliceMode = () => {
    setSlicingParams((p) => ({
      ...p,
      singleSliceMode: !p.singleSliceMode,
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

      if (sceneState.camera && sceneState.controls) {
        const size = new THREE.Vector3();
        loadedGeometry.boundingBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = sceneState.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5;
        sceneState.camera.position.set(center.x, center.y, center.z + cameraZ);
        sceneState.camera.lookAt(center);
        sceneState.controls.target.copy(center);
        sceneState.controls.update();
      }

      // Initial slicing (now debounced)
      // The actual slicing logic will be triggered by the debouncedSlicingParams useEffect
    },
    undefined,
    (error) => {
      console.error("Error loading STL file:", error);
      alert("Error loading STL file. Please check the file and try again.");
    });
  }, [stlFile, sceneState.scene, sceneState.camera, sceneState.controls]);

  // --- Re-slice when debouncedSlicingParams change (if geometry exists) ---
  // This useEffect now depends on debouncedSlicingParams
  useEffect(() => {
    if (geometry && sceneState.scene) {
      clearSlices(sceneState.scene);
      if (debouncedSlicingParams.showSlices) {
        let sliceValueToRender = null;
        if (debouncedSlicingParams.singleSliceMode) {
          sliceValueToRender = debouncedSlicingParams.currentSlice;
        }
        const slicesData = getSliceSegments(
          geometry,
          debouncedSlicingParams.sliceHeight,
          sliceValueToRender,
          debouncedSlicingParams.slicingPlane
        );
        renderSlicesWithClipper(slicesData, sceneState.scene, debouncedSlicingParams.slicingPlane);
      }
    }
  }, [debouncedSlicingParams, geometry, sceneState.scene]); // Depends on debounced state

  // --- 6. Utility Functions ---
  const clearSlices = (scene) => {
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
   * @returns {Array<{ value: number, segments: Array<Array<THREE.Vector3>> }>} An array of objects,
   * each containing the slice plane value and its raw segments.
   */
  const getSliceSegments = useCallback((geometry, heightStep, currentSliceVal, plane) => {
    const pos = geometry.attributes.position;
    const bbox = geometry.boundingBox;
    const slicesData = [];

    if (!bbox) {
      console.warn("Bounding box not computed for geometry. Cannot slice.");
      return slicesData;
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
    } else {
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

    // Increased epsilon for filtering very small segments
    const epsilon = 1e-5; // Increased from 1e-6

    valuesToSlice.forEach((value) => {
      const segmentsForCurrentSlice = [];

      for (let i = 0; i < pos.count; i += 3) {
        p1.fromBufferAttribute(pos, i);
        p2.fromBufferAttribute(pos, i + 1);
        p3.fromBufferAttribute(pos, i + 2);

        const triangle = [p1, p2, p3];
        const currentTriangleIntersectionPoints = [];

        for (let j = 0; j < 3; j++) {
          const v1 = triangle[j];
          const v2 = triangle[(j + 1) % 3];

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
          if (currentTriangleIntersectionPoints[0].distanceTo(currentTriangleIntersectionPoints[1]) > epsilon) {
            segmentsForCurrentSlice.push(currentTriangleIntersectionPoints);
          }
        }
      }
      if (segmentsForCurrentSlice.length > 0) {
        slicesData.push({ value: value, segments: segmentsForCurrentSlice });
      }
    });
    return slicesData;
  }, []); // useCallback with empty dependency array for stability

  /**
   * renderSlicesWithClipper
   * Renders the slice contours using js-clipper for robust polygon reconstruction.
   * @param {Array<{ value: number, segments: Array<Array<THREE.Vector3>> }>} slicesData Data for each slice plane.
   * @param {THREE.Scene} scene The Three.js scene to add lines to.
   * @param {'X' | 'Y' | 'Z'} plane The slicing plane, used for projection.
   */
  const renderSlicesWithClipper = useCallback((slicesData, scene, plane) => {
    const CL_SCALE = 10000000; // Increased scale factor for ClipperLib (10 million)

    slicesData.forEach(sliceData => {
      const { value: slicePlaneValue, segments: rawSegments } = sliceData;

      if (rawSegments.length === 0) {
        return;
      }

      const clipper = new ClipperLib.Clipper();
      const subjectPaths = new ClipperLib.Paths();

      rawSegments.forEach(segment => {
        const p1 = segment[0];
        const p2 = segment[1];

        let x1, y1, x2, y2;

        if (plane === "Z") {
          x1 = p1.x; y1 = p1.y;
          x2 = p2.x; y2 = p2.y;
        } else if (plane === "X") {
          x1 = p1.y; y1 = p1.z;
          x2 = p2.y; y2 = p2.z;
        } else { // Y plane
          x1 = p1.x; y1 = p1.z;
          x2 = p2.x; y2 = p2.z;
        }

        const intP1 = { X: Math.round(x1 * CL_SCALE), Y: Math.round(y1 * CL_SCALE) };
        const intP2 = { X: Math.round(x2 * CL_SCALE), Y: Math.round(y2 * CL_SCALE) };

        const path = new ClipperLib.Path();
        path.push(intP1);
        path.push(intP2);
        subjectPaths.push(path);
      });
      
      clipper.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true); 

      const solutionPolyTree = new ClipperLib.PolyTree();
      let clipperSuccess = false;
      try {
        clipperSuccess = clipper.Execute(
          ClipperLib.ClipType.ctUnion,
          solutionPolyTree,
          ClipperLib.PolyFillType.pftNonZero,
          ClipperLib.PolyFillType.pftNonZero
        );

        if (!clipperSuccess) {
          console.warn(`ClipperLib Execute failed for slice at value: ${slicePlaneValue}. Falling back to raw segments.`);
          rawSegments.forEach(segment => {
            const segmentGeometry = new THREE.BufferGeometry().setFromPoints(segment);
            const segmentMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
            const line = new THREE.LineSegments(segmentGeometry, segmentMaterial);
            line.name = "sliceLine";
            scene.add(line);
          });
          return;
        }
      } catch (e) {
        console.error(`ClipperLib threw an error for slice at value: ${slicePlaneValue}. Error:`, e, 'Falling back to raw segments. Raw segments:', JSON.stringify(rawSegments.map(s => s.map(p => p.toArray()))));
        rawSegments.forEach(segment => {
          const segmentGeometry = new THREE.BufferGeometry().setFromPoints(segment);
          const segmentMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
          const line = new THREE.LineSegments(segmentGeometry, segmentMaterial);
          line.name = "sliceLine";
          scene.add(line);
        });
        return;
      }

      const solutionPaths = ClipperLib.Clipper.PolyTreeToPaths(solutionPolyTree);

      solutionPaths.forEach(path => {
        if (path.length < 2) return;

        const threeJsPoints = [];
        path.forEach(intPoint => {
          const x = intPoint.X / CL_SCALE;
          const y = intPoint.Y / CL_SCALE;

          let threeDPoint;
          if (plane === "Z") {
            threeDPoint = new THREE.Vector3(x, y, slicePlaneValue);
          } else if (plane === "X") {
            threeDPoint = new THREE.Vector3(slicePlaneValue, x, y);
          } else {
            threeDPoint = new THREE.Vector3(x, slicePlaneValue, y);
          }
          threeJsPoints.push(threeDPoint);
        });

        if (threeJsPoints.length > 1) {
          const sliceGeometry = new THREE.BufferGeometry().setFromPoints(threeJsPoints.concat(threeJsPoints[0]));
          const sliceMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
          const sliceLine = new THREE.LineLoop(sliceGeometry, sliceMaterial);
          sliceLine.name = "sliceLine";
          scene.add(sliceLine);
        }
      });
    });
  }, []); // useCallback with empty dependency array for stability

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
        } else {
          px = x;
          py = z;
        }

        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);

        pathD += i === 0 ? `M ${px.toFixed(3)} ${(-py).toFixed(3)}` : ` L ${px.toFixed(3)} ${(-py).toFixed(3)}`;
      }
      if (line instanceof THREE.LineLoop) {
        pathD += " Z";
      }

      const strokeColor = `#${line.material.color.getHexString()}`;
      svgPaths += `<path d="${pathD}" stroke="${strokeColor}" stroke-width="0.05" fill="none"/>`;
    });

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
      const numSegments = line instanceof THREE.LineLoop ? pos.count : pos.count / 2;

      for (let i = 0; i < numSegments; i++) {
        const p1x = pos.getX(i);
        const p1y = pos.getY(i);
        const p1z = pos.getZ(i);

        let nextIndex;
        if (line instanceof THREE.LineLoop) {
          nextIndex = (i + 1) % pos.count;
        } else {
          nextIndex = i * 2 + 1;
          if (i % 2 === 0) {
            nextIndex = i + 1;
          } else {
            continue;
          }
        }
        
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
        } else {
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

  const minRangeValue = geometry && geometry.boundingBox
    ? geometry.boundingBox.min[slicingParams.slicingPlane.toLowerCase()]
    : 0;

  const maxRangeValue = geometry && geometry.boundingBox
    ? geometry.boundingBox.max[slicingParams.slicingPlane.toLowerCase()]
    : 100;

  let totalLayers = 0;
  let currentLayerIndex = 0;
  let modelDimensions = { x: 0, y: 0, z: 0 };

  if (geometry && geometry.boundingBox && slicingParams.sliceHeight > 0) {
    const range = maxRangeValue - minRangeValue;
    totalLayers = Math.floor(range / slicingParams.sliceHeight) + 1;

    const clampedCurrentSlice = Math.max(minRangeValue, Math.min(maxRangeValue, slicingParams.currentSlice));
    currentLayerIndex = Math.floor((clampedCurrentSlice - minRangeValue) / slicingParams.sliceHeight);
    currentLayerIndex = Math.max(0, Math.min(totalLayers - 1, currentLayerIndex));

    const size = new THREE.Vector3();
    geometry.boundingBox.getSize(size);
    modelDimensions = {
      x: size.x.toFixed(2),
      y: size.y.toFixed(2),
      z: size.z.toFixed(2),
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
