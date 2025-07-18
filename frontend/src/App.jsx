import React, { useState } from "react";
import STLViewer from "./STLViewer";

const App = () => {
  const [stlUrl, setStlUrl] = useState(null);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file && file.name.toLowerCase().endsWith(".stl")) {
      const url = URL.createObjectURL(file);
      setStlUrl(url);
    } else {
      alert("Please upload a valid STL file.");
    }
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "10px", backgroundColor: "#222", color: "white" }}>
        <h1>STL Viewer</h1>
        <input type="file" accept=".stl" onChange={handleFileChange} />
      </header>
      <main style={{ flexGrow: 1 }}>
        <STLViewer stlFile={stlUrl} />
      </main>
    </div>
  );
};

export default App;
