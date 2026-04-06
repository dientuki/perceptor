import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { translate } from "@/core/ia/google";
import path from "path";


function srtToJson(path: string) {
  const content = fs.readFileSync(path, "utf-8");

  const blocks = content.trim().split(/\n\s*\n/);

  const result = blocks.map(block => {
    const lines = block.split("\n");
    const id = lines[0];
    const timestamp = lines[1];
    const text = lines.slice(2).join("\n");

    return { id, timestamp, text };
  });

  return result;
}

async function translateTextsInChunks(
  items: { id: string; text: string }[],
  chunkSize = 100
) {
  const results: string[] = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const texts = chunk.map(x => x.text);

    const tranlatedTexts = await translate(texts);

    console.log(`chunk ${i + 1} of ${Math.ceil(items.length / chunkSize)} translated, Chunk: ${texts.length} items Traducido: ${tranlatedTexts.length} items`);

    results.push(...tranlatedTexts);
  }

  // reconstruir estructura original
  return items.map((item, i) => ({
    ...item,
    text: results[i],
  }));
}

function mergeTranslations(
  original: { id: string; timestamp: string; text: string }[],
  translated: { id: string; text: string }[]
) {
  const translatedMap = new Map(
    translated.map(item => [item.id, item.text])
  );

  return original.map(item => ({
    ...item,
    text: translatedMap.get(item.id) ?? item.text
  }));
}

function jsonToSrt(
  items: { id: string; timestamp: string; text: string }[]
): string {
  return items
    .map(item =>
      `${item.id}
${item.timestamp}
${item.text}`
    )
    .join("\n\n") + "\n";
}

function buildLatinoPath(file: string) {
  const dir = path.dirname(file);
  const ext = path.extname(file); // .srt
  const base = path.basename(file, ext);

  return path.join(dir, `${base}.latino${ext}`);
}

export async function POST(req: NextRequest) {
  try {
    const { file }  = await req.json();

    if (!file) {
      return NextResponse.json(
        { error: "file is required" },
        { status: 400 }
      );
    }

    const original = srtToJson(file);
    const withoutTimestamp = original.map(({ timestamp, ...rest }) => rest);

    //const translated = await translate(JSON.stringify(withoutTimestamp));
    const translated = await translateTextsInChunks(withoutTimestamp, 50);

    const merged = mergeTranslations(original, translated);
    const srtContent = jsonToSrt(merged);

    const outputPath = buildLatinoPath(file);

    fs.writeFileSync(outputPath, srtContent, "utf-8");

    console.log("Archivo generado:", outputPath);

    //console.log(translated);

    return NextResponse.json(
      { status: 202 }
    );
  } catch (error) {
    console.error(error);

return NextResponse.json(
      { error: "Failed to create import job" },
      { status: 500 }
    );
  }
}