import { spawn } from "child_process";
import fs from "fs";

// Ahora devolvemos una Promesa que resuelve al terminar el proceso
export function runFfmpeg(args: string[], finalPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempPath = finalPath.replace(/\.mkv$/, ".working.mkv");
    const finalArgs = [...args.slice(0, -1), tempPath];

    console.log(`\n🚀 Iniciando proceso FFmpeg...`);
    console.log(`🎬 Destino final: ${finalPath}`);

    const child = spawn("ffmpeg", finalArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.on("error", (err) => {
      console.error(`\n💥 Error al iniciar FFmpeg: ${err.message}`);
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      reject(err); // Avisamos que falló el inicio
    });

    child.stderr.on("data", (data) => {
      const line = data.toString();
      if (line.includes("fps=") || line.includes("time=")) {
        process.stdout.write(`\r🚀 ${line.trim().substring(0, 100)}`);
      } else {
        console.log(`\n[FFmpeg Log] ${line.trim()}`);
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        try {
          if (fs.existsSync(tempPath)) {
            fs.renameSync(tempPath, finalPath);
            console.log(`\n\n✅ COMPLETADO EXITOSAMENTE: ${finalPath}`);
            resolve(); // ¡Éxito!
          }
        } catch (err) {
          console.error(`\n❌ Error al renombrar: ${err}`);
          reject(err);
        }
      } else {
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch (e) {}
        }
        console.error(`\n\n❌ ERROR: Código ${code}`);
        reject(new Error(`FFmpeg falló con código ${code}`));
      }
    });

    // Manejo de cierre forzado de Node
    const killHandler = () => {
      if (!child.killed) {
        child.kill("SIGINT");
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    };
    process.once("exit", killHandler);
    process.once("SIGINT", killHandler);
  });
}