import { spawn } from "node:child_process";
import path from "node:path";

export function runPythonKardex(pdfPath: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const pythonExe = "python";
        const script = path.join(process.cwd(), "src/scripts/kardex.py");

        const child = spawn(pythonExe, [script, pdfPath], {
            cwd: process.cwd(),
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (d) => (stdout += d.toString("utf-8")));
        child.stderr.on("data", (d) => (stderr += d.toString("utf-8")));

        child.on("close", (code) => {
            if (code !== 0) {
                return reject(new Error(`Python exited ${code}: ${stderr || stdout}`));
            }

            try{
                const parsed = JSON.parse(stdout);
                resolve(parsed);
            }catch (e) {
                reject(new Error(`Invalid JSON from python: ${e}\nRaw: ${stdout}`));
            }
        })
    })
}