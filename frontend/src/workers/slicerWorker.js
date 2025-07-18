// src/workers/slicerWorker.js

// Import ClipperLib directly in the worker
import * as ClipperLib from 'js-clipper';
import * as THREE from 'three'; // Import Three.js for Vector3, BufferGeometry etc.

// Define CL_SCALE here, consistent with the main thread
const CL_SCALE = 10000000; // Increased scale factor for ClipperLib (10 million)
const EPSILON = 1e-5; // Epsilon for floating point comparisons

/**
 * getSliceSegments (Worker-side)
 * Extracts raw intersection points (segments) for each slice plane.
 * This function focuses only on finding the intersections, not on contour reconstruction.
 * It operates on raw position array and bounding box data.
 * @param {Float32Array} positionArray The raw position attribute array from BufferGeometry.
 * @param {object} bboxData Bounding box data {min: {x,y,z}, max: {x,y,z}}.
 * @param {number} heightStep The height between slices.
 * @param {number | null} currentSliceVal If not null, only slice at this specific value.
 * @param {'X' | 'Y' | 'Z'} plane The slicing plane (e.g., 'Z' for XY slices).
 * @returns {Array<{ value: number, segments: Array<Array<number[]>> }>} An array of objects,
 * each containing the slice plane value and its raw segments (as array of [x, y, z] arrays).
 */
function getSliceSegments(positionArray, bboxData, heightStep, currentSliceVal, plane) {
    const slicesData = [];

    if (!bboxData || !bboxData.min || !bboxData.max) {
        console.warn("Bounding box data not provided to worker. Cannot slice.");
        return slicesData;
    }

    let axis;
    let min, max;
    if (plane === "Z") {
        axis = "z";
        min = bboxData.min.z;
        max = bboxData.max.z;
    } else if (plane === "X") {
        axis = "x";
        min = bboxData.min.x;
        max = bboxData.max.x;
    } else { // Y plane
        axis = "y";
        min = bboxData.min.y;
        max = bboxData.max.y;
    }

    const valuesToSlice =
        currentSliceVal !== null
            ? [currentSliceVal]
            : Array.from({ length: Math.floor((max - min) / heightStep) + 1 }, (_, i) => min + i * heightStep);

    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const p3 = new THREE.Vector3();

    valuesToSlice.forEach((value) => {
        const segmentsForCurrentSlice = [];

        for (let i = 0; i < positionArray.length; i += 9) { // 9 components per triangle (3 vertices * 3 components/vertex)
            p1.set(positionArray[i], positionArray[i + 1], positionArray[i + 2]);
            p2.set(positionArray[i + 3], positionArray[i + 4], positionArray[i + 5]);
            p3.set(positionArray[i + 6], positionArray[i + 7], positionArray[i + 8]);

            const triangle = [p1, p2, p3];
            const currentTriangleIntersectionPoints = [];

            for (let j = 0; j < 3; j++) {
                const v1 = triangle[j];
                const v2 = triangle[(j + 1) % 3];

                const val1 = v1[axis];
                const val2 = v2[axis];

                if (
                    (val1 <= value + EPSILON && val2 >= value - EPSILON) ||
                    (val2 <= value + EPSILON && val1 >= value - EPSILON)
                ) {
                    if (Math.abs(val2 - val1) < EPSILON) {
                        continue;
                    }

                    const t = (value - val1) / (val2 - val1);
                    const intersectPoint = new THREE.Vector3().lerpVectors(v1, v2, t);
                    currentTriangleIntersectionPoints.push(intersectPoint);
                }
            }

            if (currentTriangleIntersectionPoints.length === 2) {
                if (currentTriangleIntersectionPoints[0].distanceTo(currentTriangleIntersectionPoints[1]) > EPSILON) {
                    segmentsForCurrentSlice.push([
                        currentTriangleIntersectionPoints[0].toArray(),
                        currentTriangleIntersectionPoints[1].toArray()
                    ]);
                }
            }
        }
        if (segmentsForCurrentSlice.length > 0) {
            slicesData.push({ value: value, segments: segmentsForCurrentSlice });
        }
    });
    return slicesData;
}

/**
 * processSlicesWithClipper (Worker-side)
 * Processes raw segments using js-clipper and returns processed contours.
 * @param {Array<{ value: number, segments: Array<Array<number[]>> }>} slicesData Data for each slice plane.
 * @param {'X' | 'Y' | 'Z'} plane The slicing plane, used for projection.
 * @returns {Array<{ value: number, contours: Array<number[]>, isFallback: boolean }>} Processed contours.
 */
function processSlicesWithClipper(slicesData, plane) {
    const processedSlices = [];

    slicesData.forEach(sliceData => {
        const { value: slicePlaneValue, segments: rawSegments } = sliceData;

        if (rawSegments.length === 0) {
            return;
        }

        const clipper = new ClipperLib.Clipper();
        const subjectPaths = new ClipperLib.Paths();

        rawSegments.forEach(segment => {
            const p1 = new THREE.Vector3().fromArray(segment[0]);
            const p2 = new THREE.Vector3().fromArray(segment[1]);

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
        let finalContours = [];
        let isFallback = false;

        try {
            clipperSuccess = clipper.Execute(
                ClipperLib.ClipType.ctUnion,
                solutionPolyTree,
                ClipperLib.PolyFillType.pftNonZero,
                ClipperLib.PolyFillType.pftNonZero
            );

            if (!clipperSuccess) {
                console.warn(`Worker: ClipperLib Execute failed for slice at value: ${slicePlaneValue}. Falling back to raw segments.`);
                isFallback = true;
                // Convert raw segments to a flat array of points for fallback rendering
                rawSegments.forEach(segment => {
                    finalContours.push(...segment[0], ...segment[1]);
                });
            } else {
                const solutionPaths = ClipperLib.Clipper.PolyTreeToPaths(solutionPolyTree);
                solutionPaths.forEach(path => {
                    if (path.length < 2) return;
                    const threeJsPoints = [];
                    path.forEach(intPoint => {
                        const x = intPoint.X / CL_SCALE;
                        const y = intPoint.Y / CL_SCALE;

                        let threeDPoint;
                        if (plane === "Z") {
                            threeDPoint = [x, y, slicePlaneValue];
                        } else if (plane === "X") {
                            threeDPoint = [slicePlaneValue, x, y];
                        } else {
                            threeDPoint = [x, slicePlaneValue, y];
                        }
                        threeJsPoints.push(...threeDPoint); // Flatten for BufferGeometry
                    });
                    if (threeJsPoints.length > 0) {
                        finalContours.push(...threeJsPoints); // Add to final contours
                        // For LineLoop, we need to explicitly close the loop by adding the first point again
                        // This is handled on the main thread when creating THREE.LineLoop
                    }
                });
            }
        } catch (e) {
            console.error(`Worker: ClipperLib threw an error for slice at value: ${slicePlaneValue}. Error:`, e, 'Falling back to raw segments. Raw segments:', JSON.stringify(rawSegments));
            isFallback = true;
            rawSegments.forEach(segment => {
                finalContours.push(...segment[0], ...segment[1]);
            });
        }

        if (finalContours.length > 0) {
            processedSlices.push({
                value: slicePlaneValue,
                contours: finalContours, // Flattened array of coordinates
                isFallback: isFallback,
                plane: plane // Also send plane back for consistency in rendering
            });
        }
    });

    return processedSlices;
}


// Worker message handler
self.onmessage = function(event) {
    const { type, payload } = event.data;

    if (type === 'sliceModel') {
        const { positionArray, bboxData, sliceHeight, currentSlice, slicingPlane } = payload;

        // Perform slicing to get raw segments
        const slicesData = getSliceSegments(positionArray, bboxData, sliceHeight, currentSlice, slicingPlane);

        // Process segments with ClipperLib
        const processedContours = processSlicesWithClipper(slicesData, slicingPlane);

        // Send results back to main thread
        self.postMessage({ type: 'slicingComplete', payload: processedContours });
    }
};
