import { triggerImportWorker } from "../../../../worker/importWorker";
import { NextRequest, NextResponse } from "next/server";
import { JobReadyToRip } from "@/models/types";

async function getTvFromTmdb(tmdbId: number) {
  const res = await fetch(
    `https://api.themoviedb.org/3/tv/${tmdbId}?language=en-US`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        accept: "application/json",
      },
      cache: "no-store", // importante en Next
    }
  );

  if (!res.ok) {
    throw new Error(`TMDB error: ${res.status}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    first_air_date: data.first_air_date,
    name: data.name,
    original_language: data.original_language,
  };
}

async function getEpisodesFromTmdb(tmdbId: number, season: number) {
  const res = await fetch(
    `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?language=en-US`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        accept: "application/json",
      },
      cache: "no-store", // importante en Next
    }
  );

  if (!res.ok) {
    throw new Error(`TMDB error: ${res.status}`);
  }

  const data = await res.json();
  return data.episodes.map((ep: any) => ({
    number: ep.episode_number,
    name: ep.name,
  }));
}

export async function POST(req: NextRequest) {
  try {
    const { path, tmdbId, season }  = await req.json();

    if (!path || !tmdbId  || !season) {
      return NextResponse.json(
        { error: "path, tmdbId and season are required" },
        { status: 400 }
      );
    }

    const tmdbData = await getTvFromTmdb(tmdbId);

    const episodes = await getEpisodesFromTmdb(tmdbId, season);

    console.log({path, tmdbData, season, episodes });
    //return;

    // 👇 dispara worker reactivo (sin polling)
    await triggerImportWorker({path, tmdbData, season, episodes});

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