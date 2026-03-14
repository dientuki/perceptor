import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { IAClient, SearchParams } from "./types";
import { prompts } from "./prompts";

function stripFencedCodeBlock(input: string) {
  // Regex para detectar bloque de código ``` o ```json al inicio y ``` al final
  const fencedCodeRegex = /^```(?:json)?\n([\s\S]*?)\n```$/i;

  const match = input.match(fencedCodeRegex);
  if (match) {
    return match[1]; // Devuelve solo el contenido dentro del bloque
  }
  return input; // Si no hay bloque, devuelve tal cual
}

function safeJsonArrayParse(text: string, expectedLength: number): string[] {
  try {
    const cleaned = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) {
      throw new Error("Response is not an array");
    }

    if (parsed.length !== expectedLength) {
      throw new Error(
        `Length mismatch. Expected ${expectedLength}, got ${parsed.length}`
      );
    }

    return parsed;
  } catch (err) {
    console.error("Invalid AI response:\n", text);
    throw err;
  }
}

export const createGeminiClient = (config : Record<string, string>): IAClient => {
  
  const model = config.ia_model ?? 'gemini-3-flash-preview';
  const key = config.ia_key ?? "AIzaSyBRJYT05nNvPxum3yL9tXkAHQXCLCS850Q";

  //const config = { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, } };
  const ai = new GoogleGenAI({
    apiKey: key,
  });  

  return {
  
    async buildSearchParams(input: string): Promise<SearchParams> {
      const prompt = prompts.searchParams(input);

      const response = await ai.models.generateContent({
        model,
        //config,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
      });

      const text = stripFencedCodeBlock(response.text?.trim()) ?? '';

      try {
        const parsed = JSON.parse(text);
        if (parsed.endpoint && parsed.query) {
          return parsed;
        }
        throw new Error('JSON generado inválido');
      } catch (err) {
        throw new Error(`No se pudo parsear el JSON: ${text}`);
      }      
    },

    async buildMediaList(input: string, json: string): Promise<any[]> {
      const prompt = prompts.mediaList(input, json);

      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
      });

      const raw = response.text ?? '';

      const ids = raw
        .trim()
        .split(',')                  // separar por coma
        .map(id => id.trim())        // limpiar espacios
        .filter(id => /^\d+$/.test(id)) // solo números válidos
        .map(Number);                // convertir a number

      let items: any[] = [];
      try {
        items = JSON.parse(json);
      } catch (e) {
        console.error("Error parsing JSON in buildMediaList", e);
        return [];
      }

      return items.filter((item: any) => ids.includes(item.id));
    },

    async translate(texts: string[]): Promise<string[]> {
      const prompt = prompts.translate(texts);

      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      });

      const raw = response.text ?? "";

      return safeJsonArrayParse(raw, texts.length);
    }
  };

};