import { spawn } from "child_process";
import fs from "fs";

export function runFfmpeg(args: string[], finalPath: string) {
  // Aseguramos que el reemplazo solo sea al final de la extensión
  const tempPath = finalPath.replace(/\.mkv$/, ".working.mkv");
  
  const finalArgs = [...args.slice(0, -1), tempPath];

  // Agregamos un log del comando exacto para poder debuguear si falla
  console.log(`\n🚀 Ejecutando FFmpeg con PID...`);
  console.log(`🎬 Destino final: ${finalPath}`);

  // Usamos stdio: ["ignore", "pipe", "pipe"] para evitar que stdin bloquee
  const child = spawn("ffmpeg", finalArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false // Cambiar a true si quieres que viva fuera del proceso de Node
  });

  // Capturar errores de inicio (ej. ffmpeg no instalado)
  child.on("error", (err) => {
    console.error(`\n💥 Error al iniciar FFmpeg: ${err.message}`);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  });

  child.stderr.on("data", (data) => {
    const line = data.toString();
    
    // Si la línea tiene progreso, la imprimimos en la misma línea (limpia)
    if (line.includes("fps=") || line.includes("time=")) {
      process.stdout.write(`\r🚀 ${line.trim().substring(0, 100)}`);
    } else {
      // SI NO ES PROGRESO, ES UN LOG O UN ERROR: Imprimirlo normal
      // Esto te mostrará el "Invalid argument" o "Codec not found"
      console.log(`\n[FFmpeg Log] ${line.trim()}`);
    }
  });

  child.on("close", (code) => {
    if (code === 0) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.renameSync(tempPath, finalPath);
          console.log(`\n\n✅ COMPLETADO EXITOSAMENTE: ${finalPath}`);
        }
      } catch (err) {
        console.error(`\n❌ Error al renombrar el archivo: ${err}`);
      }
    } else {
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
          console.error(`\n\n❌ ERROR: FFmpeg salió con código ${code}. Limpiando temporal...`);
        } catch (e) { /* ignore */ }
      }
    }
  });

  // OPCIONAL: Matar el proceso de ffmpeg si el proceso de Node se cierra
  process.on("exit", () => {
    if (!child.killed) child.kill("SIGINT");
  });

  return child.pid;
}