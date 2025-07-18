import React, { useState } from "react";
import STLViewer from "./STLViewer";

export default function App() {
  const [stlFileUrl, setStlFileUrl] = useState(null);
  const [fileName, setFileName] = useState(null);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file && file.name.endsWith(".stl")) {
      const url = URL.createObjectURL(file);
      setStlFileUrl(url);
      setFileName(file.name);
      console.log("File uploaded:", file.name);
      console.log("Blob URL:", url);
    } else {
      alert("Please upload a valid .stl file");
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Upload an STL file</h2>
      <input type="file" accept=".stl" onChange={handleFileChange} />
      {fileName && <p>Loaded file: {fileName}</p>}
      <div style={{ height: "600px", marginTop: 20 }}>
        {stlFileUrl ? (
          <STLViewer stlFile={stlFileUrl} />
        ) : (
          <p>Please upload an STL file to view it.</p>
        )}
      </div>
    </div>
  );
}
