// slicerWorker.js
// This worker is responsible for performing the computationally intensive slicing
// of a 3D STL model into 2D cross-sections (ribs) based on user-defined parameters.

import * as THREE from 'three'; // Import Three.js for geometry handling
import { STLLoader } from 'three/addons/loaders/STLLoader.js'; // Import STLLoader for parsing STL files

// Listen for messages from the main thread
self.onmessage = async function(event) {
    const { type, payload } = event.data;

    // Handle 'sliceModel' message to start the slicing process
    if (type === 'sliceModel') {
        const { stlBuffer, scaleFactor, config } = payload; // Receive scaleFactor from main thread

        // Extract configuration parameters from the payload
        const {
            materialThickness,
            laserKerf,
            slicingOrientation,
            numInterconnects, // New parameter: number of interconnects
        } = config;

        console.log('Worker received slice request with config:', config);

        try {
            // 1. Parse the STL data using STLLoader
            const loader = new STLLoader();
            const geometry = loader.parse(stlBuffer);

            // --- Apply Model Scaling ---
            // Scale the geometry to fit the target bounding box (200x200x300mm)
            geometry.scale(scaleFactor, scaleFactor, scaleFactor);
            geometry.computeBoundingBox(); // Recompute bounding box after scaling

            // 2. Perform Multi-Axis Slicing
            const slicedOutlines = await performMultiAxisSlicing(
                geometry,
                materialThickness,
                slicingOrientation,
                config // Pass full config for future use in joint generation
            );

            // 3. (Future Step) Generate Interconnections here based on numInterconnects and materialThickness
            // This is where the tabs/slots would be added to the 2D outlines.
            // The size of these cutouts will depend on `materialThickness` and `laserKerf`.
            // The number of cutouts will depend on `numInterconnects`.

            // Send the complete sliced outlines back to the main thread
            self.postMessage({
                type: 'slicingComplete',
                payload: {
                    outlines: slicedOutlines,
                    config: config // Send config back so main thread knows slicing parameters
                }
            });

        } catch (error) {
            console.error('Error in slicerWorker:', error);
            // Send an error message back to the main thread if something goes wrong
            self.postMessage({
                type: 'slicingError',
                payload: { message: error.message }
            });
        }
    }
};

/**
 * Performs multi-axis slicing on a 3D model geometry.
 * This function iterates through planes along the specified axis and calls
 * a sub-function to find intersections.
 *
 * @param {THREE.BufferGeometry} geometry The 3D model geometry (from STLLoader).
 * @param {number} materialThickness The desired spacing between each 2D slice.
 * @param {string} slicingOrientation The axis along which to slice ('X', 'Y', 'Z').
 * @param {object} config The full configuration object (for future expansion).
 * @returns {Array<Array<Array<number>>>} An array of slices, where each slice
 * contains an array of 2D loops (polygons),
 * and each loop is an array of [x, y] points.
 */
async function performMultiAxisSlicing(geometry, materialThickness, slicingOrientation, config) {
    const outlines = [];
    const bbox = geometry.boundingBox; // Get the bounding box of the *scaled* model

    let minCoord, maxCoord, planeNormal, upVector, axisIndex;

    // Determine the slicing axis and set up coordinates and vectors accordingly
    switch (slicingOrientation.toUpperCase()) {
        case 'X':
            minCoord = bbox.min.x;
            maxCoord = bbox.max.x;
            planeNormal = new THREE.Vector3(1, 0, 0); // Plane perpendicular to X-axis
            upVector = new THREE.Vector3(0, 1, 0);    // Y-axis becomes 'up' in the 2D slice plane (X-slice = YZ plane)
            axisIndex = 0;
            break;
        case 'Y':
            minCoord = bbox.min.y;
            maxCoord = bbox.max.y;
            planeNormal = new THREE.Vector3(0, 1, 0); // Plane perpendicular to Y-axis
            upVector = new THREE.Vector3(0, 0, 1);    // Z-axis becomes 'up' in the 2D slice plane (Y-slice = XZ plane)
            axisIndex = 1;
            break;
        case 'Z':
        default: // Default to Z-axis slicing if not specified or invalid
            minCoord = bbox.min.z;
            maxCoord = bbox.max.z;
            planeNormal = new THREE.Vector3(0, 0, 1); // Plane perpendicular to Z-axis
            upVector = new THREE.Vector3(0, 1, 0);    // Y-axis becomes 'up' in the 2D slice plane (Z-slice = XY plane)
            axisIndex = 2;
            break;
    }

    // Calculate the number of slices needed based on model extent and material thickness
    const modelExtent = maxCoord - minCoord;
    const numberOfSlices = Math.floor(modelExtent / materialThickness); // Use floor to ensure full slices

    console.log(`Slicing along ${slicingOrientation} axis. Model extent: ${modelExtent.toFixed(2)}mm. Material thickness: ${materialThickness}mm. Generating ${numberOfSlices} slices.`);

    // Iterate through each desired slice position
    for (let i = 0; i < numberOfSlices; i++) {
        const slicePosition = minCoord + (i * materialThickness) + (materialThickness / 2); // Slice through the middle of the material
        const plane = new THREE.Plane();
        // Define the slicing plane: a point on the plane and its normal
        plane.setFromNormalAndCoplanarPoint(planeNormal, new THREE.Vector3().copy(planeNormal).multiplyScalar(slicePosition));

        // Call the detailed intersection function
        const sliceLoops = intersectMeshWithPlane(geometry, plane, axisIndex, planeNormal, upVector);

        if (sliceLoops && sliceLoops.length > 0) {
            outlines.push(sliceLoops);
        }

        // Post progress updates back to the main thread
        self.postMessage({
            type: 'slicingProgress',
            payload: { progress: (i / numberOfSlices) * 100 }
        });
    }

    console.log('Slicing complete. Total slices generated:', outlines.length);
    return outlines;
}


/**
 * IMPORTANT: This function now implements basic plane-mesh intersection.
 * It finds line segments where the plane cuts triangles.
 * The "stitching" of these segments into closed loops is still a complex
 * part that is outlined conceptually but not fully implemented here.
 * For now, it returns raw segments as individual "loops" for visual feedback.
 *
 * @param {THREE.BufferGeometry} geometry The 3D model geometry.
 * @param {THREE.Plane} plane The slicing plane.
 * @param {number} axisIndex The index of the axis being sliced (0 for X, 1 for Y, 2 for Z).
 * @param {THREE.Vector3} planeNormal Normal of the slicing plane.
 * @param {THREE.Vector3} upVector Vector defining 'up' for the 2D projection.
 * @returns {Array<Array<Array<number>>>} An array of "loops" (currently raw segments),
 * where each loop is an array of [x, y] points.
 */
function intersectMeshWithPlane(geometry, plane, axisIndex, planeNormal, upVector) {
    const segments = []; // To store all intersection line segments found
    const loops = [];    // To store the final closed 2D polygons

    const positionAttribute = geometry.attributes.position;
    const indexAttribute = geometry.index;

    // Define a small epsilon for floating point comparisons to handle precision issues
    const EPSILON = 1e-6;

    /**
     * Helper function to check if two 3D points are approximately equal.
     * @param {THREE.Vector3} p1
     * @param {THREE.Vector3} p2
     * @returns {boolean} True if points are approximately equal.
     */
    function arePointsEqual(p1, p2) {
        return p1.distanceTo(p2) < EPSILON;
    }

    /**
     * Helper function to calculate intersection of a line segment with a plane.
     * Returns the intersection point (THREE.Vector3) or null if no intersection within segment.
     * Handles cases where a vertex or edge lies exactly on the plane.
     * @param {THREE.Vector3} p1 Start point of the line segment.
     * @param {THREE.Vector3} p2 End point of the line segment.
     * @param {THREE.Plane} plane The plane to intersect with.
     * @returns {THREE.Vector3 | null} The intersection point, or null.
     */
    function intersectLinePlane(p1, p2, plane) {
        const line = new THREE.Line3(p1, p2);
        const intersectionPoint = new THREE.Vector3();
        const result = plane.intersectLine(line, intersectionPoint);

        if (result) {
            // Check if the intersection point is within the segment (inclusive of endpoints)
            const dist1 = intersectionPoint.distanceTo(p1);
            const dist2 = intersectionPoint.distanceTo(p2);
            const segmentLength = p1.distanceTo(p2);

            if (dist1 < segmentLength + EPSILON && dist2 < segmentLength + EPSILON) {
                return intersectionPoint;
            }
        }
        return null;
    }

    /**
     * Helper function to project a 3D point onto the 2D plane defined by uVector and vVector.
     * @param {THREE.Vector3} point3D The 3D point to project.
     * @param {THREE.Vector3} origin An origin point on the 2D plane.
     * @param {THREE.Vector3} uVector The U-axis of the 2D plane.
     * @param {THREE.Vector3} vVector The V-axis of the 2D plane.
     * @returns {Array<number>} An array [x2D, y2D] representing the projected point.
     */
    function projectTo2D(point3D, origin, uVector, vVector) {
        const relativePoint = new THREE.Vector3().subVectors(point3D, origin);
        const x2D = relativePoint.dot(uVector);
        const y2D = relativePoint.dot(vVector);
        return [x2D, y2D];
    }

    // Create a local basis for the 2D plane (u, v vectors)
    const planeOrigin = plane.coplanarPoint(new THREE.Vector3());
    const uVector = new THREE.Vector3().crossVectors(planeNormal, upVector).normalize();
    const vVector = new THREE.Vector3().crossVectors(uVector, planeNormal).normalize();


    // Iterate through triangles to find intersection segments
    if (indexAttribute) {
        // Indexed geometry: iterate through faces using indices
        for (let i = 0; i < indexAttribute.count; i += 3) {
            const iA = indexAttribute.getX(i + 0);
            const iB = indexAttribute.getX(i + 1);
            const iC = indexAttribute.getX(i + 2);

            const vA = new THREE.Vector3().fromBufferAttribute(positionAttribute, iA);
            const vB = new THREE.Vector3().fromBufferAttribute(positionAttribute, iB);
            const vC = new THREE.Vector3().fromBufferAttribute(positionAttribute, iC);

            const triangleVertices = [vA, vB, vC];
            const intersectionPointsForTriangle = [];

            // Check each edge of the triangle for intersection with the plane
            for (let j = 0; j < 3; j++) {
                const p1 = triangleVertices[j];
                const p2 = triangleVertices[(j + 1) % 3]; // Next vertex in loop

                const intersection = intersectLinePlane(p1, p2, plane);
                if (intersection) {
                    // Add intersection point only if it's not already added (due to precision or shared edges)
                    let found = false;
                    for(const existingPoint of intersectionPointsForTriangle) {
                        if (arePointsEqual(existingPoint, intersection)) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        intersectionPointsForTriangle.push(intersection);
                    }
                }
            }

            // If a triangle intersects the plane, it will typically have two intersection points,
            // forming a line segment.
            if (intersectionPointsForTriangle.length === 2) {
                // Project the 3D intersection points to 2D
                const p1_2D = projectTo2D(intersectionPointsForTriangle[0], planeOrigin, uVector, vVector);
                const p2_2D = projectTo2D(intersectionPointsForTriangle[1], planeOrigin, uVector, vVector);

                // For now, we'll treat each segment as a separate "loop" for visualization.
                // The actual stitching logic would combine these.
                loops.push([p1_2D, p2_2D]);
            }
            // Cases where a triangle edge or vertex lies exactly on the plane
            // are complex and might result in more than 2 points or degenerate segments.
            // A robust solution would need to handle these carefully.
        }
    } else {
        // Non-indexed geometry: iterate directly through vertex triplets (each triplet is a triangle)
        for (let i = 0; i < positionAttribute.count; i += 9) {
            const vA = new THREE.Vector3(positionAttribute.getX(i+0), positionAttribute.getY(i+0), positionAttribute.getZ(i+0));
            const vB = new THREE.Vector3(positionAttribute.getX(i+3), positionAttribute.getY(i+3), positionAttribute.getZ(i+3));
            const vC = new THREE.Vector3(positionAttribute.getX(i+6), positionAttribute.getY(i+6), positionAttribute.getZ(i+6));

            const triangleVertices = [vA, vB, vC];
            const intersectionPointsForTriangle = [];

            for (let j = 0; j < 3; j++) {
                const p1 = triangleVertices[j];
                const p2 = triangleVertices[(j + 1) % 3];

                const intersection = intersectLinePlane(p1, p2, plane);
                if (intersection) {
                    let found = false;
                    for(const existingPoint of intersectionPointsForTriangle) {
                        if (arePointsEqual(existingPoint, intersection)) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        intersectionPointsForTriangle.push(intersection);
                    }
                }
            }

            if (intersectionPointsForTriangle.length === 2) {
                const p1_2D = projectTo2D(intersectionPointsForTriangle[0], planeOrigin, uVector, vVector);
                const p2_2D = projectTo2D(intersectionPointsForTriangle[1], planeOrigin, uVector, vVector);
                loops.push([p1_2D, p2_2D]);
            }
        }
    }

    // IMPORTANT: The stitching logic to combine these raw segments into coherent closed loops
    // is still conceptual and not fully implemented here.
    // For now, this function will return individual line segments.
    // The STLViewer.jsx will draw these as many small line loops.

    return loops;
}
