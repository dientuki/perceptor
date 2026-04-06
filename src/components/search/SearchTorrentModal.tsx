"use client";
import React from "react";
import { Modal } from "@/components/ui/modal";
import { Database } from "lucide-react";
import { MediaType, Episode, Movie } from "@prisma/client";
import SearchTorrent from "./SearchTorrent";

interface SearchTorrentModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: Movie | Episode | null;
  mediaType: MediaType;
  showTitle?: string;
  seasonNumber?: number;
}

export default function SearchTorrentModal({ isOpen, onClose, item, mediaType, showTitle, seasonNumber }: SearchTorrentModalProps) {
  if (!item) return null;

  const titleText = mediaType === MediaType.MOVIE 
    ? (item as Movie).title 
    : (item as Episode).title || `Episode ${(item as Episode).episodeNumber}`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[1200px] m-4">
      <div className="relative w-full max-h-[calc(100vh-2rem)] flex flex-col p-4 bg-white rounded-3xl dark:bg-gray-900 lg:p-11 overflow-hidden">
        <div className="px-2 pr-14 flex-shrink-0">
          <h4 className="mb-2 text-2xl font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
            <Database className="size-6 text-blue-500" />
            Buscador de Torrents
          </h4>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400 lg:mb-7">
            Buscando lanzamientos para{" "}
            <span className="font-medium text-gray-800 dark:text-white">{titleText}</span>.
          </p>
        </div>
        <div className="px-2 flex flex-col flex-1 min-h-0">
          <SearchTorrent 
            item={item} 
            mediaType={mediaType} 
            showTitle={showTitle}
            seasonNumber={seasonNumber}
            onClose={onClose}
          />
        </div>
      </div>
    </Modal>
  );
}