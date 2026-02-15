import { NextRequest, NextResponse } from "next/server";
import { getMetadata } from "@/core/ffmpeg/metadata"; // Importación limpia
import { spawn } from "child_process";
import { getVideoParams, getAudioParams, getSubtitleParams } from "@/core/ffmpeg/params";
import { runFfmpeg } from "@/core/ffmpeg/runner";

export async function POST(req: NextRequest) {
  const { filename, language } = await req.json();

  if (!filename) {
    return NextResponse.json({ error: "Falta el nombre de archivo" }, { status: 400 });
  }

  const outputName = filename.replace(".mkv", "_av1.mkv");

  try {
    // 1. Usar el helper
    const data = await getMetadata(filename);
    
    // Aquí sigue tu lógica de:
    // 2. Procesar JSON
    // Separamos los streams por tipo
    const vStream = data.streams.find((s: any) => s.codec_type === "video");
    const aStreams = data.streams.filter((s: any) => s.codec_type === "audio");
    const sStreams = data.streams.filter((s: any) => s.codec_type === "subtitle");    
    // 3. Generar comando
    const ffmpegArgs = [
      "-i", filename,
      //"-t", "00:01:00", // Solo para pruebas, elimina esto después
      ...getVideoParams(vStream),
      ...getAudioParams(aStreams, language),
      ...getSubtitleParams(sStreams, language),
      "-map_metadata:g", "-1", // Limpiamos tags basura
      "-y",                  // Sobrescribir
      outputName
    ];

    // 4. Ejecutar spawn
    
    console.log("🚀 Comando listo:", ffmpegArgs.join(" "));
    const pid = runFfmpeg(ffmpegArgs, outputName);
    console.log(`🆔 Proceso iniciado con PID: ${pid}`);

    return NextResponse.json({ ok: true, msg: "Proceso iniciado" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}