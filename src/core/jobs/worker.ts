import db from "@/db/client";
import { runFfmpeg } from "@/core/ffmpeg/runner";
import { getMetadata } from "@/core/ffmpeg/metadata";
import { getVideoParams, getAudioParams, getSubtitleParams } from "@/core/ffmpeg/params";

let isWorking = false;

export async function startWorker() {
  if (isWorking) return;
  console.log("🤖 Worker de FFmpeg: Escuchando cola secuencial...");
  loop(); // Llamamos a la función que se queda en bucle
}

async function loop() {
  isWorking = true;
  try {
    const job = db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY id ASC LIMIT 1").get() as any;

    if (job) {
      // 1. Marcamos que el i9 ya lo agarró
      db.prepare("UPDATE jobs SET status = 'processing' WHERE id = ?").run(job.id);

      // 2. BUSCAMOS LA METADATA Y GENERAMOS LOS ARGS 
      const data = await getMetadata(job.filename);
      const vStream = data.streams.find((s: any) => s.codec_type === "video");
      const aStreams = data.streams.filter((s: any) => s.codec_type === "audio");
      const sStreams = data.streams.filter((s: any) => s.codec_type === "subtitle");
      
      const outputName = job.filename.replace(".mkv", "_av1.mkv");

      const ffmpegArgs = [
        "-i", job.filename,
        "-t", "00:01:00", // Solo para pruebas, elimina esto después
        ...getVideoParams(vStream),
        ...getAudioParams(aStreams, job.language),
        ...getSubtitleParams(sStreams, job.language),
        "-map_metadata:g", "-1",
        "-y",
        outputName
      ];

      // 3. AHORA SÍ, ESPERAMOS (AWAIT)
      // Como el loop es una función async, el await frena todo acá 
      // y no busca otro trabajo hasta que este termine.
      await runFfmpeg(ffmpegArgs, outputName);

      db.prepare("UPDATE jobs SET status = 'completed' WHERE id = ?").run(job.id);
    }
  } catch (error) {
    // Manejar error...
  } finally {
    isWorking = false;
    setTimeout(loop, 5000); // Reintentar en 5 segundos
  }
}