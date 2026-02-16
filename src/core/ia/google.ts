import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.IA_API_KEY,
});

const model = process.env.IA_MODEL || 'gemini-3-flash-preview'; // mejor que preview

const config = { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, } };

function stripFencedCodeBlock(input: string) {
  // Regex para detectar bloque de código ``` o ```json al inicio y ``` al final
  const fencedCodeRegex = /^```(?:json)?\n([\s\S]*?)\n```$/i;

  const match = input.match(fencedCodeRegex);
  if (match) {
    return match[1]; // Devuelve solo el contenido dentro del bloque
  }
  return input; // Si no hay bloque, devuelve tal cual
}

export async function buildTmdbSearchUrl(input: string): Promise<TmdbSearch> {
  const prompt = `Tu tarea es generar exclusivamente un JSON válido para javascript con dos campos: endpoint y query, sin codificar.
Reglas obligatorias:
- Si el input parece una película → endpoint: /search/movie
- Si el input parece una serie → endpoint: /search/tv
- Si no es posible discernir → endpoint: /search/multi
- No Fenced Code Block
- JSON en crudo

Formato final esperado: 
{
"endpoint": "{endpoint_aqui}",
"query": "{query_aqui}"
}
Input del usuario: "${input}"`;

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

  console.log(text);

  try {
    const parsed = JSON.parse(text);
    if (parsed.endpoint && parsed.query) {
      return parsed;
    }
    throw new Error('JSON generado inválido');
  } catch (err) {
    throw new Error(`No se pudo parsear el JSON: ${text}`);
  }
}

export async function buildMediaList(input: string, json: string): Promise<string> {
  
  const prompt = `Dado este JSON de TMDB y el input del usuario, determina que está solicitando el usuario. 
Prioriza: 
- La saga o serie principal si hay varias coincidencias. 
- La fecha de lanzamiento más reciente. 
- Si el input esta en plural seleciona mas de uno.

Formato de salida para serie: Nombre
Formato de salida para pelicula: Nombre (Año de lanzamiento)

Input del usuario: "${input}"
JSON: ${json}`;

  console.log(prompt);

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

  return response.text?.trim() ?? '';
}