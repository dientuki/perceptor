import { spawn } from "child_process";
import fs from "fs";
import { logger } from "@/lib/logger";
import { update } from "@/models/jobs.model";

export function runFfmpeg(id: number, args: string[], finalPath: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const tempPath = finalPath.replace(/\.mkv$/, ".working.mkv");
    const finalArgs = [...args.slice(0, -1), tempPath];

    logger.info({ finalPath }, "🚀 Iniciando FFmpeg | Destino");
    const finalCmd = `ffmpeg ${finalArgs.map(arg => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ")}`;

    await update(id, { ffmpegCommand: finalCmd });
    
    logger.info({finalCmd}, `Ejecutando comando: ${finalCmd}`);

    const child = spawn("ffmpeg", finalArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Definimos el manejador de señales para poder removerlo después
    const killHandler = () => {
      if (!child.killed) {
        logger.info("🛑 Matando proceso FFmpeg por cierre de sistema...");
        child.kill("SIGINT");
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    };

    // Escuchamos el cierre del servidor
    process.once("SIGINT", killHandler);
    process.once("exit", killHandler);

    child.on("error", (err) => {
      cleanupListeners();
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      reject(err);
    });

    child.stderr.on("data", (data) => {
      const line = data.toString();
      if (line.includes("fps=") || line.includes("time=")) {
        process.stdout.write(`\r🚀 ${line.trim().substring(0, 100)}`);
      }
    });

    child.on("close", async (code) => {
      cleanupListeners();

      if (code === 0) {
        try {
          if (fs.existsSync(tempPath)) {
            logger.info("Muxing con mkvmerge para corregir metadatos...");

            // En lugar de renameSync, usamos mkvmerge
            const merge = spawn("mkvmerge", [
              "-o", finalPath,  // Destino final (.mkv)
              tempPath           // Origen (.working.mkv)
            ]);

            merge.on("close", (mergeCode) => {
              if (mergeCode === 0) {
                // Si mkvmerge terminó bien, borramos el temporal
                fs.unlinkSync(tempPath);
                logger.info({ finalPath }, "✅ Muestreo y Metadatos corregidos. COMPLETADO.");
                resolve();
              } else {
                reject(new Error(`mkvmerge falló con código ${mergeCode}`));
              }
            });

            merge.on("error", (err) => {
              logger.error(err, "Error ejecutando mkvmerge");
              reject(err);
            });

          }
        } catch (err) {
          reject(err);
        }
      } else {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        reject(new Error(`FFmpeg code ${code}`));
      }
    });

    // Función interna para limpiar la memoria de Node
    function cleanupListeners() {
      process.removeListener("SIGINT", killHandler);
      process.removeListener("exit", killHandler);
    }
  });
}