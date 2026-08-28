"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Children, type ReactNode, useCallback, useRef, useState } from "react";

interface MediaCarouselProps {
  heading: ReactNode;
  children: ReactNode;
}

// A pixel margin so floating-point scroll positions still count as "at the
// end" — without it, `atEnd` can stay false forever on some zoom levels.
const EDGE_MARGIN_PX = 2;

// A dependency-free, natively-scrolling carousel (Jellyseerr's `Slider`
// structure, without its `react-spring`/`lodash` dependencies — see
// `033-billboard-and-navigation`'s web/plan.md). The browser owns all
// pointer/touch/wheel scrolling; this component only pages the strip with
// the two arrow buttons and mirrors the strip's real scroll position back
// into their disabled state via `onScroll`.
export function MediaCarousel({ heading, children }: MediaCarouselProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateEdges = useCallback((el: HTMLDivElement) => {
    setAtStart(el.scrollLeft <= EDGE_MARGIN_PX);
    setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - EDGE_MARGIN_PX);
  }, []);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      updateEdges(event.currentTarget);
    },
    [updateEdges],
  );

  const cardWidth = useCallback(() => {
    const strip = stripRef.current;
    const firstCard = strip?.firstElementChild as HTMLElement | null;
    return firstCard?.getBoundingClientRect().width ?? 0;
  }, []);

  const scrollByScreen = useCallback(
    (direction: 1 | -1) => {
      const strip = stripRef.current;
      const width = cardWidth();
      if (!strip || width === 0) {
        return;
      }
      const cardsPerScreen = Math.max(1, Math.floor(strip.clientWidth / width));
      const delta = cardsPerScreen * width * direction;
      strip.scrollBy({ left: delta, behavior: "smooth" });
    },
    [cardWidth],
  );

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-black dark:text-white">
          {heading}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => scrollByScreen(-1)}
            disabled={atStart}
            aria-label="previous"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-theme-xs transition disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-800 dark:bg-white/[0.03] dark:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => scrollByScreen(1)}
            disabled={atEnd}
            aria-label="next"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-theme-xs transition disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-800 dark:bg-white/[0.03] dark:text-white"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div
        ref={stripRef}
        onScroll={handleScroll}
        className="no-scrollbar flex snap-x snap-mandatory scroll-smooth gap-4 overflow-x-auto overscroll-x-contain"
      >
        {Children.map(children, (child) => (
          // Fixed responsive width so `cardWidth` (measured off the first
          // child) is consistent across the strip, and `snap-start` so each
          // card settles flush against the strip's left edge.
          <div className="w-[140px] flex-none snap-start sm:w-[160px] md:w-[180px] lg:w-[200px]">
            {child}
          </div>
        ))}
      </div>
    </section>
  );
}
