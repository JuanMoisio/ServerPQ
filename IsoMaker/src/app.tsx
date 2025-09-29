import React, { useEffect, useState } from "react";

type Drive = {
  letter: string;
  volumeLabel?: string;
  sizeDisplay: number;
  model?: string;
  physIndex: number;
};

declare global {
  interface Window {
    api: any;
  }
}

export default function App() {
  const [drives, setDrives] = useState<Drive[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [log, setLog] = useState<string>("");
  const [exePath, setExePath] = useState<string>("");
  const [captureLabel, setCaptureLabel] = useState<string>("");

  useEffect(() => {
    refresh();
    (async () => {
      try {
        const p = await window.api.ventoyDefaultPath();
        if (p) setExePath(p);
      } catch {}
    })();
  }, []);

  const hasAPI = typeof window !== "undefined" && (window as any).api;

useEffect(() => {
  // Diagnóstico visible en consola del renderer
  console.log("[renderer] window.api =", hasAPI ? Object.keys((window as any).api) : hasAPI);
}, []);
async function refresh() {
  if (!hasAPI) { setLog("window.api no disponible (preload)"); return; }
  try { setDrives(await window.api.listDrives()); }
  catch (e:any) { setLog(String(e?.message || e)); }
}


  async function fullInstall() {
    if (!selected) return alert("Elegí un USB");
    setLog(`→ Preparando ${selected}: Ventoy (GPT) + WinPE + PQTools`);
     if (!hasAPI) { setLog("window.api no disponible (preload)"); return; }

    // 1) Ventoy
    try {
      const r = await window.api.ventoyStart({
        exePath,
        mode: "install",
        target: selected,
        flags: { gpt: true },
      });
      setLog(
        (l) =>
          (l ? l + "\n" : "") +
          `Ventoy lanzado (launcher PID ${r?.launcherPid ?? "n/a"}). Confirmá el UAC y Start en la GUI.`
      );
    } catch (e: any) {
      setLog((l) => (l ? l + "\n" : "") + `Ventoy ERROR: ${e?.message || e}`);
      return;
    }

    // 2) WinPE pack
    try {
      const r = await window.api.winpeInstallPack({ driveLetter: selected });
      setLog(
        (l) =>
          (l ? l + "\n" : "") +
          `WinPE OK → ISO: ${r.isoDst} | Scripts: ${r.scriptsDir}${
            r.copied?.wimlib ? " | wimlib OK" : ""
          }`
      );
    } catch (e: any) {
      setLog((l) => (l ? l + "\n" : "") + `WinPE ERROR: ${e?.message || e}`);
    }

    // 3) PQTools
    try {
      const src = await window.api.pqtoolsDefaultSrc();
      const r = await window.api.pqtoolsInstall({
        driveLetter: selected,
        srcDir: src || undefined,
        defaultLabel: captureLabel || undefined,
      });
      setLog(
        (l) =>
          (l ? l + "\n" : "") +
          `PQTools OK → ${r.targetDir} (wimlib=${r.hasWimlib ? "OK" : "faltante"})`
      );
    } catch (e: any) {
      setLog((l) => (l ? l + "\n" : "") + `PQTools ERROR: ${e?.message || e}`);
    }

    // 4) Probe rápido Ventoy
    try {
      const pr = await window.api.ventoyProbe(selected, "VENTOY");
      setLog(
        (l) =>
          (l ? l + "\n" : "") +
          `Verificación Ventoy:\n  - \\ventoy\\: ${pr.hasVdir ? "sí" : "no"}\n  - \\ventoy\\ventoy.json: ${
            pr.hasVjson ? "sí" : "no"
          }`
      );
    } catch {}

    setLog(
      (l) =>
        (l ? l + "\n" : "") +
        `✅ USB ${selected} listo: Ventoy + WinPE + PQTools.`
    );
    refresh();
  }

  return (
    <div className="hacker-shell">
      {/* Overlay: blackout + calavera gigante */}
      <div className="omen" aria-hidden="true" />

      <div className="panel" style={{ position: "relative" }}>
        {/* sello */}
        <div className="stamp">— by moisio —</div>

        {/* título + tagline con glitch */}
        <h1 className="title">PQ-USB Creator ☠️</h1>
        <h2
          className="tagline"
          data-text="the way to save your bytes"
        >
          the way to save your bytes
        </h2>

        {/* prompt tipo consola */}
        <div style={{ marginTop: 12 }}>
          <span className="prompt">root@serverpq</span>:
          <span style={{ color: "var(--text-dim)" }}>/usb</span>
          <span className="cursor" />
        </div>

        {/* DRIVES */}
        <section style={{ marginTop: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <h3 className="title" style={{ fontSize: 18 }}>
              Unidades USB
            </h3>
            <button className="btn" onClick={refresh}>
              Refrescar USB
            </button>
          </div>

          <ul className="list" style={{ marginTop: 8 }}>
            {drives.length === 0 && (
              <li style={{ color: "var(--text-dim)" }}>
                no se detectaron unidades
              </li>
            )}
            {drives.map((d) => (
              <li key={d.letter} style={{ marginBottom: 6 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="drive"
                    value={d.letter}
                    onChange={() => setSelected(d.letter)}
                    style={{ accentColor: "#18ffa6" }}
                  />
                  <span>
                    <b>{d.letter}</b> — {d.volumeLabel || "sin etiqueta"} —{" "}
                    {d.sizeDisplay} GB — {d.model} (Phy #{d.physIndex})
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        {/* INSTALAR TODO */}
        <section className="panel" style={{ marginTop: 16 }}>
          <h3 className="title" style={{ fontSize: 18 }}>
            Instalar todo
          </h3>

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              value={exePath}
              onChange={(e) => setExePath(e.target.value)}
              placeholder="Ruta a Ventoy2Disk.exe"
            />
            <button
              className="btn"
              onClick={async () => {
                const p = await window.api.ventoyPickExe();
                if (p) setExePath(p);
              }}
            >
              Buscar EXE
            </button>
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 8,
              alignItems: "center",
            }}
          >
            <input
              className="input"
              style={{ flex: 1 }}
              value={captureLabel}
              onChange={(e) => setCaptureLabel(e.target.value)}
              placeholder="Nombre para la imagen (opcional)"
            />
            <div
              style={{
                width: 160,
                fontSize: 12,
                opacity: 0.8,
                textAlign: "center",
              }}
            >
              [label opcional]
            </div>
          </div>

          <button
            className="btn"
            onClick={fullInstall}
            disabled={!selected}
            style={{ marginTop: 10 }}
          >
            🚀 Instalar TODO en {selected || "USB"}
          </button>

          <p style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
            Nota: Ventoy requiere confirmar UAC y presionar <b>Start</b> en su
            GUI.
          </p>
        </section>

        {/* LOGS */}
        <section style={{ marginTop: 16 }}>
          <h3 className="title" style={{ fontSize: 18 }}>
            Logs
          </h3>
          <textarea
            readOnly
            value={log}
            className="log"
            style={{
              width: "100%",
              height: 260,
              fontFamily: "ui-monospace",
              whiteSpace: "pre-wrap",
            }}
          />
        </section>
      </div>
    </div>
  );
}
