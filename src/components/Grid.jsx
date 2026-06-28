import React, { useEffect, useRef } from 'react';
import Card from './Card.jsx';

export default function Grid({
  items,
  getProxiedImageUrl,
  favorites,
  onToggleFavorite,
  onBlockUser,
  onSelectImage,
  selectedImages,
  onCardClick,
  onAddSubredditFilter,
  isLoading,
  onLoadMore,
  hasMore
}) {
  const sentinelRef = useRef(null);

  // Setup infinite scroll intersection observer
  useEffect(() => {
    if (!sentinelRef.current) return;

    const observer = new IntersectionObserver((entries) => {
      const first = entries[0];
      if (first.isIntersecting && !isLoading && hasMore) {
        console.log("Sentinel visible, loading more images...");
        onLoadMore();
      }
    }, {
      rootMargin: '200px' // Load ahead
    });

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [isLoading, hasMore, onLoadMore]);

  return (
    <main class="max-w-7xl mx-auto p-4 flex-grow w-full">
      {items.length === 0 && !isLoading ? (
        <div class="flex flex-col items-center justify-center py-20 text-gray-500">
          <span class="text-4xl mb-3">🖼️</span>
          <p class="text-sm font-semibold">No media to display</p>
          <p class="text-xs mt-1">Make sure you have active tags selected in settings.</p>
        </div>
      ) : (
        <div class="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 w-full">
          {items.map((item, idx) => {
            const firstMedia = item.mediaItems?.[0] || item;
            const isFav = favorites.some(f => (f.mediaItems && f.mediaItems[0].src === firstMedia.src) || f.src === firstMedia.src);
            const isSelected = selectedImages.has(firstMedia.src);
            
            return (
              <Card 
                key={`${firstMedia.src}-${idx}`}
                item={item}
                getProxiedImageUrl={getProxiedImageUrl}
                isFavorite={isFav}
                onToggleFavorite={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(item);
                }}
                onBlockUser={onBlockUser}
                onSelectImage={onSelectImage}
                isSelected={isSelected}
                onCardClick={() => onCardClick(idx)}
                onAddSubredditFilter={(name) => onAddSubredditFilter(name)}
              />
            );
          })}
        </div>
      )}

      {/* Infinite Scroll Trigger Sentinel */}
      <div 
        ref={sentinelRef} 
        class="h-20 w-full flex items-center justify-center mb-6"
      >
        {isLoading && (
          <div class="flex flex-col items-center gap-2">
            <div class="w-8 h-8 border-4 border-reddit border-t-transparent rounded-full animate-spin-slow"></div>
            <span class="text-xs text-gray-500 font-semibold select-none">Loading more content...</span>
          </div>
        )}
      </div>
    </main>
  );
}
