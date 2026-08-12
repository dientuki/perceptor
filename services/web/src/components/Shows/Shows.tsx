"use client";
import { useState, useEffect } from 'react';
import { getShows, Show } from '@/actions/shows';
import { MediaList } from "@/components/media/MediaList";
import { MEDIA_TYPE } from '@/types/media';


export default function Shows() {
  const [dbShows, setDbShows] = useState<Show[]>([]);

  useEffect(() => {
    loadShows();
  }, []);

  const loadShows = async () => {
    try {
      const shows = await getShows();
      setDbShows(shows);
      console.log('Series cargadas desde DB:', shows);
    } catch (err) {
      console.error('Error al cargar series de DB:', err);
    }
  };

  return (
    <div>
      <MediaList
        items={dbShows}
        mediaType={MEDIA_TYPE.SHOW}
        showLink={true}
      />
    </div>
  );
}
