import { NextRequest, NextResponse } from "next/server";
import db from "@/db/client";

export async function POST(req: NextRequest) {
  try {
    const { ids } = await req.json();

    console.log("IDs recibidos para procesar:", ids);

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, message: "No IDs provided" });
    }

    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT data FROM search_cache WHERE tmdb_id IN (${placeholders})`);
    const rows = stmt.all(...ids) as { data: string }[];
    
    const items = rows.map((row) => JSON.parse(row.data));

    console.log("Items recuperados de cache:", items);

    return NextResponse.json({ success: true, received: ids, items });
  } catch (error) {
    console.error("Error en /api/process:", error);
    return NextResponse.json({ error: "Error procesando la solicitud" }, { status: 500 });
  }
}