import React from 'react';

const BoundingBoxInfo = ({ boundingBox }) => {
  if (!boundingBox) return null;

  const width = (boundingBox.max.x - boundingBox.min.x).toFixed(2);
  const height = (boundingBox.max.y - boundingBox.min.y).toFixed(2);
  const depth = (boundingBox.max.z - boundingBox.min.z).toFixed(2);

  return (
    <div>
      <h3>Bounding Box (mm)</h3>
      <ul>
        <li>Width (X): {width} mm</li>
        <li>Height (Y): {height} mm</li>
        <li>Depth (Z): {depth} mm</li>
      </ul>
    </div>
  );
};

export default BoundingBoxInfo;
