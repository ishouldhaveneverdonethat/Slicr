import STLViewer from "./components/STLViewer";

function App() {
  const stlUrl = "/example.stl"; // replace with your actual STL path

  return <STLViewer stlFile={stlUrl} />;
}

export default App;
