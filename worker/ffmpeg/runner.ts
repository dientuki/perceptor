import { spawn } from "child_process";
import fs from "fs";
import { logger } from "@/lib/logger";

export function runFfmpeg(args: string[], finalPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempPath = finalPath.replace(/\.mkv$/, ".working.mkv");
    const finalArgs = [...args.slice(0, -1), tempPath];

    logger.info({ finalPath }, "🚀 Iniciando FFmpeg | Destino");
    const finalCmd = `ffmpeg ${finalArgs.map(arg => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ")}`;
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

    child.on("close", (code) => {
      cleanupListeners(); // IMPORTANTE: Quitar los listeners de process

      if (code === 0) {
        try {
          if (fs.existsSync(tempPath)) {
            fs.renameSync(tempPath, finalPath);
            logger.info({finalPath}, "✅ COMPLETADO");
            resolve();
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