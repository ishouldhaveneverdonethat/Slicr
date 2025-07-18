import * as THREE from 'three';
import { saveAs } from 'file-saver';

export function exportAsSVG(slices, scale) {
  const svgPaths = slices.map((slice, i) => {
    const pathData = slice
      .map(p => `${p.x * scale} ${-p.y * scale}`)
      .join(' L ');
    return `<path d="M ${pathData} Z" stroke="red" stroke-width="0.05" fill="none" />`;
  });

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1">
${svgPaths.join('\n')}
</svg>`;

  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  saveAs(blob, 'slices.svg');
}

export function exportAsDXF(slices, scale) {
  let dxfContent = `0\nSECTION\n2\nENTITIES\n`;

  slices.forEach(slice => {
    dxfContent += `0\nLWPOLYLINE\n8\n0\n70\n1\n90\n${slice.length}\n`;
    slice.forEach(p => {
      dxfContent += `10\n${(p.x * scale).toFixed(3)}\n20\n${(p.y * scale).toFixed(3)}\n`;
    });
    dxfContent += `0\nSEQEND\n`;
  });

  dxfContent += `0\nENDSEC\n0\nEOF`;

  const blob = new Blob([dxfContent], { type: 'application/dxf' });
  saveAs(blob, 'slices.dxf');
