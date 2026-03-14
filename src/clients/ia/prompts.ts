export const prompts = {
  searchParams: (input: string) => 
`Tu tarea es generar exclusivamente un JSON válido para javascript con dos campos: type y query, sin codificar.
Reglas obligatorias:
- Si el input parece una película → type: movie
- Si el input parece una serie → type: tv
- Si no es posible discernir → type: multi
- No Fenced Code Block
- JSON en crudo

Formato final esperado: 
{
"type": "{type_aqui}",
"query": "{query_aqui}"
}
Input del usuario: "${input}"`,

  mediaList: (input: string, json: string) => 
`Dado este JSON y el input del usuario, determina qué elementos coinciden con la intención del usuario.
Reglas obligatorias (en orden de prioridad):

- Si el input contiene palabras o expresiones que indiquen temporalidad reciente, como: "última", "el último", "la más reciente", "la nueva", "la final",  "la más nueva", "la más actual", "la reciente", "lo último", debes seleccionar SOLO un elemento: el de fecha de lanzamiento más reciente dentro de esa saga o franquicia.
- Si el input está en plural (ej: "las", "todas", "películas", "pelis", etc.) selecciona múltiples elementos relevantes.
- Si el input está en singular y NO menciona una expresion que indiquen temporalidad reciente selecciona solo el elemento más relevante.

Retornar el id de cada item, si son muchos separados por coma.

Input del usuario: "${input}"
JSON: ${json}`,

  translate: (texts: string[]) =>
`Actuá como un experto en localización de subtítulos.
  Traducí el siguiente array de strings de español de España a español de Argentina, aplicando estrictamente el voseo y terminología local.
  Voseo Obligatorio: Cambiá 'tú' por 'vos' y 'vosotros' por 'ustedes'. Ajustá los verbos (ej: 'tienes' -> 'tenés', 'venid' -> 'vengan', 'sabéis' -> 'saben', 'haces' -> 'hacés').
  Vocabulario General: Cambiá 'aparcar' por 'estacionar', 'ordenador' por 'computadora', 'zumo' por 'jugo', 'tío' por 'chabón/tipo', 'molar' por 'estar bueno', 'trabajo/curro' por 'laburo', 'dinero/pasta' por 'plata/guita', 'vale' por 'dale/está bien'.
  Vocabulario Fierrero (Específico):
  - Neumáticos -> Cubiertas o Gomas.
  - Capó -> Capot.
  - Maletero -> Baúl.
  - Gasolina -> Nafta.
  - Llantas, caja de cambios (mantener igual).
  Corrección de Modelos (Initial D):
  - Cambiá '8.6' por '86'.
  - Cambiá 'S-1.3' por 'S13'.

  REGLAS DE INTEGRIDAD
  - Manten la cantidad de elementos del array
  - Manten el orden de los elementos
  - Respeta los saltos de linea que estan con el caracter\n

  JSON INPUT:
  ${JSON.stringify(texts)}`
};