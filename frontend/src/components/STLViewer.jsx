import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';

// CORRECTED PATH: This path now correctly points to slicerWorker.js
// relative to STLViewer.jsx's location (/frontend/src/components/).
// slicerWorker.js is located at /frontend/src/workers/slicerWorker.js.
const slicerWorker = new Worker(new URL('../workers/slicerWorker.js', import.meta.url), { type: 'module' });

const STLViewer = ({ stlUrl }) => {
    // Refs for Three.js elements to persist across renders
    const mountRef = useRef(null);
    const sceneRef = useRef(null);
    const rendererRef = useRef(null);
    const cameraRef = useRef(null);
    const controlsRef = useRef(null);

    // Groups for organizing 3D objects in the scene
    const modelGroupRef = useRef(new THREE.Group()); // Group for the main STL model
    const sliceGroupRef = useRef(new THREE.Group()); // Group specifically for displaying sliced outlines

    // State variables for managing sliced data and UI interactions
    const [slicedData, setSlicedData] = useState(null);
    const [currentSliceIndex, setCurrentSliceIndex] = useState(0);
    const [slicingAxis, setSlicingAxis] = useState('Z'); // User-selected axis for slicing (X, Y, or Z)

    // User-defined parameters for slicing and interconnects
    const materialThicknessOptions = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const [materialThickness, setMaterialThickness] = useState(4.0); // Default 4mm
    const [laserKerf, setLaserKerf] = useState(0.15); // Default 0.15mm

    const [numInterconnects, setNumInterconnects] = useState(3); // Default 3 interconnects

    const [loadingProgress, setLoadingProgress] = useState(0);
    const [isSlicing, setIsSlicing] = useState(false);

    // Callback to load an STL file from a URL, resize it, and trigger the slicing worker
    const loadSTL = useCallback(async (url) => {
        if (!url) {
            console.error("No STL URL provided.");
            return;
        }
        setIsSlicing(true); // Indicate slicing has started
        setLoadingProgress(0); // Reset progress

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const arrayBuffer = await response.arrayBuffer(); // Get STL data as ArrayBuffer

            // Clear any previously loaded model from the scene
            modelGroupRef.current.clear();

            // Parse the STL geometry
            const loader = new STLLoader();
            const geometry = loader.parse(arrayBuffer);

            // --- Model Resizing Logic ---
            geometry.computeBoundingBox();
            const bbox = geometry.boundingBox;
            const size = bbox.getSize(new THREE.Vector3());

            const targetWidth = 200;
            const targetHeight = 200;
            const targetDepth = 300; // Assuming Z is depth for the 300mm dimension

            // Calculate scaling factors for each dimension
            const scaleX = targetWidth / size.x;
            const scaleY = targetHeight / size.y;
            const scaleZ = targetDepth / size.z;

            // Use the minimum scale factor to ensure the model fits within all dimensions
            const scaleFactor = Math.min(scaleX, scaleY, scaleZ);

            geometry.scale(scaleFactor, scaleFactor, scaleFactor);
            // Recompute bounding box after scaling
            geometry.computeBoundingBox();
            const scaledBbox = geometry.boundingBox;
            const scaledCenter = scaledBbox.getCenter(new THREE.Vector3());

            // Create a material for the STL model
            const material = new THREE.MeshPhongMaterial({
                color: 0xcccccc, // Grey color for the model
                specular: 0x111111,
                shininess: 200
            });
            const mesh = new THREE.Mesh(geometry, material);

            // Center the scaled model in the scene
            mesh.position.sub(scaledCenter);

            // Add the model to its group, and the group to the scene
            modelGroupRef.current.add(mesh);

            // Prepare the configuration object for the slicing worker
            const config = {
                materialThickness: parseFloat(materialThickness),
                laserKerf: parseFloat(laserKerf),
                slicingOrientation: slicingAxis,
                numInterconnects: parseInt(numInterconnects, 10), // Pass new parameter
            };

            // Send the original buffer and the scaling factor to the worker
            slicerWorker.postMessage({
                type: 'sliceModel',
                payload: {
                    stlBuffer: arrayBuffer, // Send original buffer
                    scaleFactor: scaleFactor, // Send the calculated scale factor
                    config: config
                }
            }, [arrayBuffer]); // Transfer buffer for efficiency

        } catch (error) {
            console.error("Error loading or processing STL:", error);
            setIsSlicing(false); // Stop loading indicator on error
        }
    }, [slicingAxis, materialThickness, laserKerf, numInterconnects]); // Dependencies for useCallback

    // Effect hook for initializing the Three.js scene (runs once on component mount)
    useEffect(() => {
        const currentMount = mountRef.current;
        if (!currentMount) return;

        const width = currentMount.clientWidth;
        const height = currentMount.clientHeight;

        // Scene setup
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf0f0f0); // Light grey background
        sceneRef.current = scene;

        // Add the model group and slice group to the scene
        scene.add(modelGroupRef.current);
        scene.add(sliceGroupRef.current); // Add the new group for slices

        // Camera setup
        const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        camera.position.set(0, 0, 400); // Adjust initial camera position for scaled models
        cameraRef.current = camera;

        // Renderer setup
        const renderer = new THREE.WebGLRenderer({ antialias: true }); // Enable anti-aliasing for smoother edges
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio); // Use device pixel ratio for high-res displays
        currentMount.appendChild(renderer.domElement); // Add renderer's canvas to the DOM
        rendererRef.current = renderer;

        // OrbitControls for interactive camera movement
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true; // Enable smooth camera movement
        controls.dampingFactor = 0.25;
        controlsRef.current = controls;

        // Lighting setup for better model visibility
        const ambientLight = new THREE.AmbientLight(0x404040, 2); // Soft white ambient light
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1); // Directional light
        directionalLight.position.set(1, 1, 1).normalize(); // Position the light
        scene.add(directionalLight);

        // Animation loop for rendering the scene
        const animate = () => {
            requestAnimationFrame(animate); // Request next frame
            controls.update(); // Update controls (for damping)
            renderer.render(scene, camera); // Render the scene
        };
        animate(); // Start the animation loop

        // Event listener for window resize to adjust renderer and camera
        const handleResize = () => {
            const newWidth = currentMount.clientWidth;
            const newHeight = currentMount.clientHeight;
            renderer.setSize(newWidth, newHeight);
            camera.aspect = newWidth / newHeight;
            camera.updateProjectionMatrix(); // Update camera projection after aspect ratio change
        };
        window.addEventListener('resize', handleResize);

        // Worker message listener for slicing results and progress
        slicerWorker.onmessage = (event) => {
            const { type, payload } = event.data;
            if (type === 'slicingComplete') {
                console.log('Main thread received sliced outlines:', payload.outlines);
                setSlicedData(payload); // Store the received outlines and config
                setCurrentSliceIndex(0); // Reset to display the first slice
                setIsSlicing(false); // Slicing is complete
                setLoadingProgress(100); // Ensure progress is 100%
            } else if (type === 'slicingProgress') {
                // Update loading progress for UI feedback
                setLoadingProgress(payload.progress);
            } else if (type === 'slicingError') {
                console.error('Slicing error:', payload.message);
                setIsSlicing(false); // Stop loading indicator on error
                setLoadingProgress(0); // Reset progress
            }
        };

        // Clean-up function to run when the component unmounts
        return () => {
            window.removeEventListener('resize', handleResize);
            if (currentMount && renderer.domElement) {
                currentMount.removeChild(renderer.domElement);
            }
            // Dispose Three.js objects to prevent memory leaks
            renderer.dispose();
            controls.dispose();
        };
    }, []); // Empty dependency array ensures this effect runs only once on mount

    // Effect hook for rendering the currently selected 2D slice
    // Runs whenever 'slicedData' or 'currentSliceIndex' changes
    useEffect(() => {
        sliceGroupRef.current.clear(); // Clear any previously rendered slice lines

        // If no sliced data or no outlines, do nothing
        if (!slicedData || !slicedData.outlines || slicedData.outlines.length === 0) {
            return;
        }

        // Get the outlines for the current slice index
        const outlinesForCurrentSlice = slicedData.outlines[currentSliceIndex];
        if (!outlinesForCurrentSlice) return;

        // Get the configuration used for slicing to correctly position the slice in 3D space
        const config = slicedData.config || {};
        const thickness = config.materialThickness || 1; // Default thickness if not found
        const orientation = config.slicingOrientation || 'Z';

        // Get the bounding box of the original model (now scaled in worker) to calculate the slice's 3D position
        // We'll rely on the worker to send back the scaled bbox or ensure consistency.
        // For now, assume the modelGroupRef's child geometry is already scaled.
        const bbox = modelGroupRef.current.children[0]?.geometry?.boundingBox;
        if (!bbox) {
            console.warn("Bounding box not available for slice positioning. Cannot render slice correctly.");
            return;
        }

        let slicePosition;
        // Calculate the 3D coordinate of the current slice based on its index and slicing axis
        switch (orientation.toUpperCase()) {
            case 'X':
                slicePosition = bbox.min.x + (currentSliceIndex * thickness) + (thickness / 2); // Center of the slice
                break;
            case 'Y':
                slicePosition = bbox.min.y + (currentSliceIndex * thickness) + (thickness / 2); // Center of the slice
                break;
            case 'Z':
            default:
                slicePosition = bbox.min.z + (currentSliceIndex * thickness) + (thickness / 2); // Center of the slice
                break;
        }

        // Iterate through each loop (polygon) within the current slice
        outlinesForCurrentSlice.forEach(loop => {
            const points = [];
            // Convert 2D points from the worker back to 3D points for Three.js
            loop.forEach(([x, y]) => {
                let p;
                // Project 2D point onto the correct 3D plane based on slicing orientation
                switch (orientation.toUpperCase()) {
                    case 'X': // Slice along X means 2D points are in Y-Z plane
                        p = new THREE.Vector3(slicePosition, x, y);
                        break;
                    case 'Y': // Slice along Y means 2D points are in X-Z plane
                        p = new THREE.Vector3(x, slicePosition, y);
                        break;
                    case 'Z': // Slice along Z means 2D points are in X-Y plane
                    default:
                        p = new THREE.Vector3(x, y, slicePosition);
                        break;
                }
                points.push(p);
            });

            // Create a BufferGeometry from the 3D points
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            // Create a basic line material (red for visibility)
            const material = new THREE.LineBasicMaterial({ color: 0xff0000 });
            // Create a LineLoop to ensure the polygon is closed
            const line = new THREE.LineLoop(geometry, material);
            // Add the line to the slice group
            sliceGroupRef.current.add(line);
        });

    }, [slicedData, currentSliceIndex]); // Dependencies: re-render when sliced data or slice index changes

    // Initial STL load when the component mounts or stlUrl changes
    useEffect(() => {
        if (stlUrl && mountRef.current) {
            loadSTL(stlUrl);
        }
    }, [stlUrl, loadSTL]); // Depend on stlUrl and loadSTL callback

    // Calculate total number of slices for UI display
    const totalSlices = slicedData?.outlines?.length || 0;

    // --- SVG Export Functionality ---
    const exportSliceAsSVG = useCallback(() => {
        if (!slicedData || !slicedData.outlines || slicedData.outlines.length === 0) {
            console.warn("No sliced data to export.");
            return;
        }

        const outlinesToExport = slicedData.outlines[currentSliceIndex];
        if (!outlinesToExport || outlinesToExport.length === 0) {
            console.warn("Current slice has no outlines to export.");
            return;
        }

        // Determine the bounding box of the 2D outlines for proper SVG viewBox
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        outlinesToExport.forEach(loop => {
            loop.forEach(([x, y]) => {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            });
        });

        const width = maxX - minX;
        const height = maxY - minY;

        // Start SVG string
        let svgContent = `<svg width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

        // Add each loop as a path
        outlinesToExport.forEach((loop, index) => {
            if (loop.length === 0) return;

            let pathData = `M ${loop[0][0]} ${loop[0][1]}`; // Move to the first point
            for (let i = 1; i < loop.length; i++) {
                pathData += ` L ${loop[i][0]} ${loop[i][1]}`; // Line to subsequent points
            }
            pathData += ' Z'; // Close the path

            svgContent += `<path d="${pathData}" fill="none" stroke="black" stroke-width="0.5mm" />`;
        });

        svgContent += `</svg>`;

        // Create a Blob from the SVG content
        const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        // Create a temporary link element to trigger download
        const link = document.createElement('a');
        link.href = url;
        link.download = `slice_${currentSliceIndex + 1}_${slicingAxis}.svg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url); // Clean up the URL object
    }, [slicedData, currentSliceIndex, slicingAxis]);


    return (
        <div style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden', fontFamily: 'Inter, sans-serif' }}>
            {/* The main container for the Three.js canvas */}
            <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

            {/* Controls for Slicing and Viewing Slices */}
            <div className="absolute top-4 left-4 bg-white bg-opacity-80 p-4 rounded-lg shadow-md flex flex-col gap-3">
                <h3 className="text-lg font-semibold mb-2">Slicing Controls</h3>

                {/* Slicing Axis Selection */}
                <div className="flex items-center gap-2">
                    <label htmlFor="slicingAxis" className="text-sm font-medium w-24">Slicing Axis:</label>
                    <select
                        id="slicingAxis"
                        value={slicingAxis}
                        onChange={(e) => {
                            setSlicingAxis(e.target.value);
                            // Re-slice when axis changes
                            if (stlUrl) {
                                loadSTL(stlUrl);
                            }
                        }}
                        className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="X">X-axis</option>
                        <option value="Y">Y-axis</option>
                        <option value="Z">Z-axis</option>
                    </select>
                </div>

                {/* Material Thickness Input (Dropdown) */}
                <div className="flex items-center gap-2">
                    <label htmlFor="materialThickness" className="text-sm font-medium w-24">Material (mm):</label>
                    <select
                        id="materialThickness"
                        value={materialThickness}
                        onChange={(e) => setMaterialThickness(parseFloat(e.target.value))}
                        className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {materialThicknessOptions.map(option => (
                            <option key={option} value={option}>{option}</option>
                        ))}
                    </select>
                </div>

                {/* Laser Kerf Input */}
                <div className="flex items-center gap-2">
                    <label htmlFor="laserKerf" className="text-sm font-medium w-24">Laser Kerf (mm):</label>
                    <input
                        id="laserKerf"
                        type="number"
                        step="0.01"
                        min="0"
                        value={laserKerf}
                        onChange={(e) => setLaserKerf(parseFloat(e.target.value))}
                        className="p-2 border border-gray-300 rounded-md w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                {/* Number of Interconnects Input */}
                <div className="flex items-center gap-2">
                    <label htmlFor="numInterconnects" className="text-sm font-medium w-24">Interconnects:</label>
                    <input
                        id="numInterconnects"
                        type="number"
                        min="3"
                        max="10"
                        step="1"
                        value={numInterconnects}
                        onChange={(e) => setNumInterconnects(parseInt(e.target.value, 10))}
                        className="p-2 border border-gray-300 rounded-md w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                {/* Re-Slice Button */}
                <button
                    onClick={() => {
                        if (stlUrl) {
                            loadSTL(stlUrl); // Trigger slicing with current settings
                        }
                    }}
                    className={`mt-2 px-4 py-2 rounded-md font-semibold transition-colors duration-200
                                ${isSlicing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                    disabled={isSlicing}
                >
                    {isSlicing ? `Slicing... ${loadingProgress.toFixed(0)}%` : 'Re-Slice Model'}
                </button>

                {/* Slice Navigation Controls (only visible if slices exist) */}
                {totalSlices > 0 && (
                    <>
                        <div className="border-t border-gray-200 pt-3 mt-3">
                            <h4 className="text-md font-semibold mb-2">View Slices</h4>
                            <div className="flex items-center gap-2">
                                <label htmlFor="sliceRange" className="text-sm font-medium w-24">Slice ({currentSliceIndex + 1} / {totalSlices}):</label>
                                <input
                                    id="sliceRange"
                                    type="range"
                                    min="0"
                                    max={totalSlices - 1}
                                    value={currentSliceIndex}
                                    onChange={(e) => setCurrentSliceIndex(parseInt(e.target.value, 10))}
                                    className="flex-grow h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                            <div className="flex justify-between mt-2">
                                <button
                                    onClick={() => setCurrentSliceIndex(prev => Math.max(0, prev - 1))}
                                    disabled={currentSliceIndex === 0}
                                    className="px-3 py-1 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Previous
                                </button>
                                <button
                                    onClick={() => setCurrentSliceIndex(prev => Math.min(totalSlices - 1, prev + 1))}
                                    disabled={currentSliceIndex === totalSlices - 1}
                                    className="px-3 py-1 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                        {/* Export SVG Button */}
                        <button
                            onClick={exportSliceAsSVG}
                            className={`mt-3 px-4 py-2 rounded-md font-semibold transition-colors duration-200
                                        bg-green-600 hover:bg-green-700 text-white`}
                        >
                            Export Current Slice as SVG
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default STLViewer;
