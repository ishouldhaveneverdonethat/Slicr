// src/workers/slicerWorker.js

import * as ClipperLib from 'js-clipper';
import * as THREE from 'three';

const CL_SCALE = 10000000; // Scale factor for ClipperLib (10 million)
const EPSILON = 1e-5; // Epsilon for filtering very small segments (e.g., zero length)
const SNAP_TOLERANCE = 0.5; // Significantly increased tolerance for snapping points, e.g., 0.5mm

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
        console.warn("Worker: Bounding box data not provided. Cannot slice.");
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
 * snapPointsToGrid (Worker-side)
 * Snaps 2D points to a grid to merge nearly coincident points,
 * improving robustness for ClipperLib.
 * @param {Array<Array<number[]>>} rawSegments Array of segments, each [point1_3D, point2_3D].
 * @param {'X' | 'Y' | 'Z'} plane The slicing plane for 2D projection.
 * @returns {Array<Array<ClipperLib.IntPoint>>} Cleaned 2D segments as ClipperLib.IntPoint arrays.
 */
function snapPointsToGrid(rawSegments, plane) {
    const snappedSegments = [];
    const uniquePointsMap = new Map(); // Map<string (key), ClipperLib.IntPoint>

    rawSegments.forEach(segment => {
        const p1_3D = new THREE.Vector3().fromArray(segment[0]);
        const p2_3D = new THREE.Vector3().fromArray(segment[1]);

        let x1_2D, y1_2D, x2_2D, y2_2D;

        if (plane === "Z") { // Project to XY plane
            x1_2D = p1_3D.x; y1_2D = p1_3D.y;
            x2_2D = p2_3D.x; y2_2D = p2_3D.y;
        } else if (plane === "X") { // Project to YZ plane
            x1_2D = p1_3D.y; y1_2D = p1_3D.z;
            x2_2D = p2_3D.y; y2_2D = p2_3D.z;
        } else { // Y plane, project to XZ plane
            x1_2D = p1_3D.x; y1_2D = p1_3D.z;
            x2_2D = p2_3D.x; y2_2D = p2_3D.z;
        }

        // Snap to grid using SNAP_TOLERANCE
        // This rounds coordinates to the nearest multiple of SNAP_TOLERANCE
        const snapFactor = 1 / SNAP_TOLERANCE; // e.g., 1 / 0.5 = 2
        const snappedX1 = Math.round(x1_2D * snapFactor) / snapFactor;
        const snappedY1 = Math.round(y1_2D * snapFactor) / snapFactor;
        const snappedX2 = Math.round(x2_2D * snapFactor) / snapFactor;
        const snappedY2 = Math.round(y2_2D * snapFactor) / snapFactor;

        // Create unique keys for the snapped points (using higher precision for keying)
        // Using a high precision for toFixed to ensure distinct snapped points get distinct keys
        const key1 = `${snappedX1.toFixed(10)},${snappedY1.toFixed(10)}`;
        const key2 = `${snappedX2.toFixed(10)},${snappedY2.toFixed(10)}`;

        let intP1, intP2;

        if (uniquePointsMap.has(key1)) {
            intP1 = uniquePointsMap.get(key1);
        } else {
            // Scale up to integers for ClipperLib
            intP1 = { X: Math.round(snappedX1 * CL_SCALE), Y: Math.round(snappedY1 * CL_SCALE) };
            uniquePointsMap.set(key1, intP1);
        }

        if (uniquePointsMap.has(key2)) {
            intP2 = uniquePointsMap.get(key2);
        } else {
            intP2 = { X: Math.round(snappedX2 * CL_SCALE), Y: Math.round(snappedY2 * CL_SCALE) };
            uniquePointsMap.set(key2, intP2);
        }

        // Only add segment if points are not identical after snapping AND scaling to ClipperLib integers
        // This ensures we don't add zero-length segments to ClipperLib
        if (intP1.X !== intP2.X || intP1.Y !== intP2.Y) {
            snappedSegments.push([intP1, intP2]);
        }
    });

    return snappedSegments;
}

/**
 * traceContours (Worker-side)
 * Traces closed contours from a set of disconnected line segments.
 * This is a crucial step to provide ClipperLib with proper polygon inputs.
 * @param {Array<Array<ClipperLib.IntPoint>>} segments An array of 2-point segments (ClipperLib.IntPoint arrays).
 * @returns {ClipperLib.Paths} An array of closed ClipperLib.Path objects.
 */
function traceContours(segments) {
    const paths = new ClipperLib.Paths();
    // Use a map to store segments by their start point, allowing quick lookup for connections
    // Key: stringified point {X,Y}, Value: Array of {segmentIndex, endpointIndex (0 for start, 1 for end)}
    const adjacencyMap = new Map();
    const usedSegments = new Set();

    segments.forEach((segment, index) => {
        const p1 = segment[0];
        const p2 = segment[1];

        const key1 = `${p1.X},${p1.Y}`;
        const key2 = `${p2.X},${p2.Y}`;

        if (!adjacencyMap.has(key1)) adjacencyMap.set(key1, []);
        if (!adjacencyMap.has(key2)) adjacencyMap.set(key2, []);

        adjacencyMap.get(key1).push({ segmentIndex: index, otherPoint: p2 });
        adjacencyMap.get(key2).push({ segmentIndex: index, otherPoint: p1 });
    });

    // Iterate through all segments to find starting points for contours
    for (let i = 0; i < segments.length; i++) {
        if (usedSegments.has(i)) continue; // Skip if this segment is already part of a contour

        const currentPath = new ClipperLib.Path();
        let currentSegmentIndex = i;
        let currentPoint = segments[i][0]; // Start with the first point of the segment
        const startPoint = currentPoint;
        const startPointKey = `${startPoint.X},${startPoint.Y}`;

        let loopDetected = false;
        let iterationCount = 0;
        const MAX_ITERATIONS = segments.length * 2 + 5; // Safety break

        while (!loopDetected && iterationCount < MAX_ITERATIONS) {
            iterationCount++;

            // Add the current point to the path if it's not the first point being added for this segment
            // or if it's the very first point of the contour.
            if (currentPath.length === 0 || (currentPath[currentPath.length - 1].X !== currentPoint.X || currentPath[currentPath.length - 1].Y !== currentPoint.Y)) {
                currentPath.push(currentPoint);
            }
            
            usedSegments.add(currentSegmentIndex);

            const segmentsFromCurrentPoint = adjacencyMap.get(`${currentPoint.X},${currentPoint.Y}`);
            if (!segmentsFromCurrentPoint || segmentsFromCurrentPoint.length === 0) {
                // Dead end, cannot form a closed loop from this chain
                break;
            }

            let foundNext = false;
            for (const conn of segmentsFromCurrentPoint) {
                if (!usedSegments.has(conn.segmentIndex)) {
                    // This is the next segment in the chain
                    currentSegmentIndex = conn.segmentIndex;
                    currentPoint = conn.otherPoint; // Move to the other endpoint of the found segment
                    foundNext = true;
                    break;
                }
            }

            if (!foundNext) {
                // No unvisited segments found from this point.
                // Check if we can close the loop by connecting back to the start point.
                if (currentPath.length > 1 && `${currentPoint.X},${currentPoint.Y}` === startPointKey) {
                    loopDetected = true;
                }
                break; // No more connections or loop not closed
            }
            
            // If we found a next segment, check if the next point is the start point to close the loop
            if (foundNext && `${currentPoint.X},${currentPoint.Y}` === startPointKey && currentPath.length > 1) {
                loopDetected = true;
                break;
            }
        }

        if (loopDetected && currentPath.length > 2) { // Ensure it's a valid polygon (at least 3 unique points)
            paths.push(currentPath);
        } else if (currentPath.length > 1) {
            // This means it was an open path that couldn't be closed.
            // For polygon operations, we generally discard open paths.
            // If we needed to render open paths, we'd handle them differently.
        }
    }

    return paths;
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
            processedSlices.push({
                value: slicePlaneValue,
                contours: [], // No contours for this slice
                isFallback: false, // Not a fallback, just empty
                plane: plane
            });
            return;
        }

        // Step 1: Snap points to a grid to merge nearly coincident vertices
        const snappedIntSegments = snapPointsToGrid(rawSegments, plane);

        if (snappedIntSegments.length === 0) {
            // After snapping, if no valid segments remain, skip this slice or treat as empty
            processedSlices.push({
                value: slicePlaneValue,
                contours: [],
                isFallback: false,
                plane: plane
            });
            return;
        }

        // Step 2: Trace closed contours from the snapped segments
        const tracedClosedPaths = traceContours(snappedIntSegments);

        const clipper = new ClipperLib.Clipper();
        const subjectPaths = new ClipperLib.Paths();

        // Add the traced closed paths to ClipperLib.
        // Now, we are explicitly telling ClipperLib that these are CLOSED polygons (true).
        tracedClosedPaths.forEach(path => {
            subjectPaths.push(path);
        });

        // Only proceed with Clipper.Execute if we have valid traced paths
        if (subjectPaths.length === 0) {
             console.warn(`Worker: No closed contours traced for slice at value: ${slicePlaneValue}. Falling back to raw segments.`);
             rawSegments.forEach(segment => {
                 finalContours.push(...segment[0], ...segment[1]);
             });
             processedSlices.push({
                 value: slicePlaneValue,
                 contours: finalContours,
                 isFallback: true,
                 plane: plane
             });
             return;
        }


        clipper.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true); // Now 'true' because we traced them as closed

        const solutionPolyTree = new ClipperLib.PolyTree();
        let clipperSuccess = false;
        let finalContours = [];
        let isFallback = false;

        try {
            // Use ctUnion to combine any overlapping or adjacent polygons
            clipperSuccess = clipper.Execute(
                ClipperLib.ClipType.ctUnion,
                solutionPolyTree,
                ClipperLib.PolyFillType.pftNonZero,
                ClipperLib.PolyFillType.pftNonZero
            );

            if (!clipperSuccess) {
                console.warn(`Worker: ClipperLib Execute failed for slice at value: ${slicePlaneValue} after tracing. Falling back to raw segments. Traced paths count: ${tracedClosedPaths.length}`);
                isFallback = true;
                rawSegments.forEach(segment => {
                    finalContours.push(...segment[0], ...segment[1]);
                });
            } else {
                const solutionPaths = ClipperLib.Clipper.PolyTreeToPaths(solutionPolyTree);
                solutionPaths.forEach(path => {
                    if (path.length < 2) return; // Need at least 2 points for a line/contour
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
                    }
                });
            }
        } catch (e) {
            console.error(`Worker: ClipperLib threw an error for slice at value: ${slicePlaneValue} after tracing. Error:`, e, 'Falling back to raw segments. Traced paths count:', tracedClosedPaths.length);
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
                plane: plane
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

        const slicesData = getSliceSegments(positionArray, bboxData, sliceHeight, currentSlice, slicingPlane);

        const processedContours = processSlicesWithClipper(slicesData, slicingPlane);

        self.postMessage({ type: 'slicingComplete', payload: processedContours });
    }
};
