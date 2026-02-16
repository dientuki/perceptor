import { NextRequest, NextResponse } from "next/server";
import { getItems } from "@/core/tmdb/storage";

export async function POST(req: NextRequest) {
  try {
    const { ids } = await req.json();

    console.log("IDs recibidos para procesar:", ids);

    const items = await getItems(ids);

    console.log("Items recuperados:", items);

    return NextResponse.json({ success: true, received: ids, items });
  } catch (error) {
    console.error("Error en /api/process:", error);
    return NextResponse.json({ error: "Error procesando la solicitud" }, { status: 500 });
  }
}