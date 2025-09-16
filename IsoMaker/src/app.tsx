import { useState } from "react";

export default function App() {
  const [log, setLog] = useState("Listo para crear USB");

  return (
    <div style={{ fontFamily: "ui-sans-serif, system-ui", padding: 24 }}>
      <h1>PQ-USB Creator (DEV)</h1>
      <p>Si ves esta pantalla, la app está viva. Luego conectamos servicios reales.</p>
      <button onClick={() => setLog("Click!")}>Probar</button>
      <pre style={{ background: "#111", color: "#0f0", padding: 12, minHeight: 120 }}>{log}</pre>
    </div>
  );
}
