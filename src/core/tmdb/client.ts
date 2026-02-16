import fetch from 'node-fetch'

const TMDB_DOMAIN = process.env.TMDB_DOMAIN || "https://api.themoviedb.org";
const TMDB_API_VERSION = process.env.TMDB_API_VERSION || "3";

const options = {
  method: 'GET',
  headers: {
    accept: 'application/json',
    Authorization: `Bearer ${process.env.TMDB_API_KEY}`
  }
};

export async function fetchAllTmdbPages({ endpoint, query }: TmdbSearch) {
  let page = 1
  let totalPages = 1
  const results: any[] = [];

  const urlPath = new URL(`${TMDB_API_VERSION}/${endpoint}`, TMDB_DOMAIN);
  urlPath.searchParams.set("query", query);
  urlPath.searchParams.set("page", page.toString());

  do {
    const res = await fetch(urlPath.toString(), options)
    const data: {
      page: number;
      total_pages: number;
      total_results: number;
      results: any[];
    } = await res.json();

    if (!data || !data.results) break

    results.push(...data.results)

    totalPages = data.total_pages ?? 1
    page++
    urlPath.searchParams.set("page",page.toString());
  } while (page <= totalPages)

  console.log(results);

  return results
}