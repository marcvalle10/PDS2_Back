import { spawn } from "child_process";
import path from "path";

export function runPythonPlan(pdfPath: string, args: string[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "src", "scripts", "plan_estudio.py");
    const py = spawn("python", [scriptPath, pdfPath, ...args], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let out = "";
    let err = "";

    py.stdout.on("data", (d) => (out += d.toString()));
    py.stderr.on("data", (d) => (err += d.toString()));
    py.on("close", (code) => {
      if (code !== 0) return reject(new Error(err || `Python exit code ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error(`Salida de Python no es JSON válido: ${e}\n${out}`));
      }
    });
  });
}
