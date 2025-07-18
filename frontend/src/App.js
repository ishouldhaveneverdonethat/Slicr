import React, { useState } from "react";

function App() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);

  const onFileChange = (e) => {
    setFile(e.target.files[0]);
    setResult(null);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!file) return alert("Please select an STL file");

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("https://slicr-1.onrender.com/", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    setResult(data);
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h1>STL Slicer MVP</h1>
      <form onSubmit={onSubmit}>
        <input type="file" accept=".stl" onChange={onFileChange} />
        <button type="submit">Upload and Slice</button>
      </form>
      {result && (
        <div style={{ marginTop: "1rem" }}>
          <strong>Response:</strong>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default App;
