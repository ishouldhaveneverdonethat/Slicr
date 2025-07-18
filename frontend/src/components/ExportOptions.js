import React from 'react';

const ExportOptions = ({ exportFormat, setExportFormat, scale, setScale, handleExport }) => {
  return (
    <div>
      <h3>Export Options</h3>

      <label>
        Format:
        <select value={exportFormat} onChange={e => setExportFormat(e.target.value)}>
          <option value="svg">SVG</option>
          <option value="dxf">DXF</option>
        </select>
      </label>

      <div>
        <label>
          Target Width (mm):
          <input
            type="number"
            value={scale.width}
            onChange={e => setScale({ ...scale, width: parseFloat(e.target.value) })}
          />
        </label>
        <label>
          Target Height (mm):
          <input
            type="number"
            value={scale.height}
            onChange={e => setScale({ ...scale, height: parseFloat(e.target.value) })}
          />
        </label>
        <label>
          Target Depth (mm):
          <input
            type="number"
            value={scale.depth}
            onChange={e => setScale({ ...scale, depth: parseFloat(e.target.value) })}
          />
        </label>
      </div>

      <button onClick={handleExport}>Export</button>
    </div>
  );
};

export default ExportOptions;
