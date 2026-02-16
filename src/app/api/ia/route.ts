import { NextRequest, NextResponse } from "next/server";
import { buildTmdbSearchUrl, buildMediaList } from "@/core/ia/google";
import { fetchAllTmdbPages } from "@/core/tmdb/client";
import { logger } from "@/lib/logger";
import db from "@/db/client";

export async function POST(req: NextRequest) {
    //const { query } = await req.json();
    ////logger.info(query);
//
    //const tmdbUrl = await buildTmdbSearchUrl(query);
    ////logger.info('endpoint', tmdbUrl);
    //
    //const allResults = await fetchAllTmdbPages(tmdbUrl);
    ////logger.info('allresult', allResults);
    //
    //const mediaList = await buildMediaList(query, JSON.stringify(allResults))
    ////logger.info('medialist',mediaList);
    ////return;

    const mediaList = [
        {
            adult: false,
            backdrop_path: '/538U9snNc2fpnOmYXAPUh3zn31H.jpg',
            genre_ids: [ 28, 53, 12 ],
            id: 575265,
            original_language: 'en',
            original_title: 'Mission: Impossible - The Final Reckoning',
            overview: "Ethan Hunt and team continue their search for the terrifying AI known as the Entity — which has infiltrated intelligence networks all over the globe — with the world's governments and a mysterious ghost from Hunt's past on their trail. Joined by new allies and armed with the means to shut the Entity down for good, Hunt is in a race against time to prevent the world as we know it from changing forever.",
            popularity: 44.0381,
            poster_path: '/z53D72EAOxGRqdr7KXXWp9dJiDe.jpg',
            release_date: '2025-05-17',
            title: 'Mission: Impossible - The Final Reckoning',
            video: false,
            vote_average: 7.191,
            vote_count: 2541
        }
    ];

    // Persistencia en SQLite (Opción 3)
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_cache (
        tmdb_id INTEGER PRIMARY KEY,
        data TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const insert = db.prepare("INSERT OR REPLACE INTO search_cache (tmdb_id, data) VALUES (?, ?)");
    const insertMany = db.transaction((items: any[]) => {
        for (const item of items) {
            insert.run(item.id, JSON.stringify(item));
        }
    });
    insertMany(mediaList);

    return NextResponse.json(mediaList);
}