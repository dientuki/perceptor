"use client";
/*
import { getAllMovies } from "@/models/movies.model";

import { MediaSearchResult } from "@/search/types";
import { MEDIA_TYPE } from "@/types/media";
import JobStatusBadge from "@/components/common/JobStatusBadge";
*/
import { useState, useEffect } from 'react';
import { getMovies, Movie } from '@/actions/movies';
import { MediaList } from "@/components/media/MediaList";
import { MEDIA_TYPE } from '@/types/media';


export default function Movies() {
  const [dbMovies, setDbMovies] = useState<Movie[]>([]);

  useEffect(() => {
    loadMovies();
  }, []);

  const loadMovies = async () => {
    try {
      const movies = await getMovies();
      setDbMovies(movies);
      console.log('Películas cargadas desde DB:', movies);
    } catch (err) {
      console.error('Error al cargar películas de DB:', err);
    }
  };
  
  return (
    <div>
      <MediaList
        items={dbMovies}
        mediaType={MEDIA_TYPE.MOVIE}
        showLink={true}
      />
    </div>
  );
}
