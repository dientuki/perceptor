import { NextRequest, NextResponse } from "next/server";
import db from "@/db/client"; // Importamos tu better-sqlite3

export async function POST(req: NextRequest) {
  const { filename, language } = await req.json();

  if (!filename) {
    return NextResponse.json({ error: "Falta el nombre de archivo" }, { status: 400 });
  }

  try {
    // 1. ANOTAR EN LA BASE DE DATOS
    // No ejecutamos nada acá. Solo guardamos el "ticket".
    const stmt = db.prepare("INSERT INTO jobs (filename, language, status) VALUES (?, ?, ?)");
    const info = stmt.run(filename, language || 'spa', 'pending');

    console.log(`📝 Job encolado con ID: ${info.lastInsertRowid}`);

    return NextResponse.json({ 
      ok: true, 
      msg: "Película agregada a la cola de espera", 
      jobId: info.lastInsertRowid 
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}