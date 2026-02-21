// types/http.ts

export const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
  OPTIONS: "OPTIONS",
  HEAD: "HEAD",
} as const;

export type HttpMethod = typeof HTTP_METHOD[keyof typeof HTTP_METHOD];