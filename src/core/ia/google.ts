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

  //console.log(text);

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

export async function buildMediaList(input: string, json: string): Promise<any[]> {
  
  const prompt = `Dado este JSON y el input del usuario, determina qué elementos coinciden con la intención del usuario.
Reglas obligatorias (en orden de prioridad):

- Si el input contiene palabras o expresiones que indiquen temporalidad reciente, como: "última", "el último", "la más reciente", "la nueva", "la final",  "la más nueva", "la más actual", "la reciente", "lo último", debes seleccionar SOLO un elemento: el de fecha de lanzamiento más reciente dentro de esa saga o franquicia.
- Si el input está en plural (ej: "las", "todas", "películas", "pelis", etc.) selecciona múltiples elementos relevantes.
- Si el input está en singular y NO menciona una expresion que indiquen temporalidad reciente selecciona solo el elemento más relevante.

Retornar el id de cada item, si son muchos separados por coma.

Input del usuario: "${input}"
JSON: ${json}`;


  // harry potter
  //671, 12445, 673, 674, 767, 672, 12444, 675

  //console.log(prompt);

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
}