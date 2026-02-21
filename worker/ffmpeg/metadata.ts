// src/core/ffmpeg/metadata.ts
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function getMetadata(filePath: string) {
  try {
    // Usamos comillas dobles para manejar espacios en los nombres de archivos
    const command = `ffprobe -v error -show_format -show_streams -of json "${filePath}"`;
    const { stdout } = await execAsync(command);
    return JSON.parse(stdout);
  } catch (error) {
    console.error("Error en ffprobe:", error);
    throw new Error("No se pudo analizar el archivo de video.");
  }
}