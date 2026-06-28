import React, { useState } from 'react';

export default function Card({
  item,
  getProxiedImageUrl,
  isFavorite,
  onToggleFavorite,
  onBlockUser,
  onSelectImage,
  isSelected,
  onCardClick,
  onAddSubredditFilter
}) {
  const firstMedia = item.mediaItems?.[0] || item;
  
  // Set up fallbacks for preview thumbnails (excluding video streams to prevent ORB errors)
  const srcOptions = [
    getProxiedImageUrl(firstMedia.thumb),
    firstMedia.thumb,
    firstMedia.type !== 'video' ? getProxiedImageUrl(firstMedia.src) : null,
    firstMedia.type !== 'video' ? firstMedia.src : null
  ].filter(v => !!v);

  const [srcIdx, setSrcIdx] = useState(0);
  const [isFailed, setIsFailed] = useState(false);

  const handleImageError = () => {
    if (srcIdx < srcOptions.length - 1) {
      setSrcIdx(srcIdx + 1);
    } else {
      setIsFailed(true);
    }
  };

  if (isFailed) return null; // Remove the card if all sources fail

  const displaySrc = srcOptions[srcIdx] || 'https://placehold.co/600x400/272729/D7DADC?text=Image+Load+Failed';

  const handleCardClick = (e) => {
    // Avoid opening modal if user clicked on specific overlay buttons
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('span')) return;
    onCardClick();
  };

  const safeTitle = (item.title || 'Untitled').replace(/'/g, "\\'");

  return (
    <div 
      onClick={handleCardClick}
      class="grid-item-enter break-inside-avoid bg-card rounded-xl overflow-hidden shadow-lg border border-gray-800/80 group hover:border-reddit/50 hover:shadow-reddit/10 transition-all duration-300 relative cursor-pointer mb-4"
    >
      {/* Batch Select Checkbox */}
      <input 
        type="checkbox"
        checked={isSelected}
        onChange={() => onSelectImage(firstMedia.src)}
        class="absolute top-3 left-3 z-30 w-4 h-4 rounded border-gray-600 text-reddit focus:ring-reddit bg-transparent cursor-pointer custom-checkbox opacity-0 group-hover:opacity-100 transition-opacity duration-300"
      />

      {/* Video Badge Overlay */}
      {firstMedia.type === 'video' && (
        <div class="absolute top-3 right-3 z-30 bg-reddit text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow select-none uppercase tracking-wider">
          Video
        </div>
      )}

      {/* Media Image Thumbnail Container */}
      <div class="relative overflow-hidden w-full h-auto aspect-auto min-h-[100px]">
        <img 
          src={displaySrc}
          alt={item.title}
          loading="lazy"
          onError={handleImageError}
          class="w-full h-full object-cover transition-all duration-500 scale-100 group-hover:scale-105"
        />
        
        {/* Dark Hover Overlay */}
        <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4 z-20">
          
          {/* Card Title */}
          <h2 class="text-white text-xs font-bold leading-snug line-clamp-3 select-none text-left mb-2">
            {item.title}
          </h2>

          {/* Card Author/Subreddit Actions */}
          <div class="text-gray-300 text-[10px] flex justify-between items-center mt-1 border-t border-gray-700/60 pt-2 select-none">
            
            {/* User Profile Block/Filter Link */}
            <div class="flex items-center gap-1.5 overflow-hidden">
              <span 
                onClick={() => onAddSubredditFilter(`u/${item.author}`)}
                class="hover:text-reddit transition-colors cursor-pointer truncate max-w-[80px]"
                title={`Filter by user u/${item.author}`}
              >
                u/{item.author}
              </span>
              <button 
                onClick={() => onBlockUser(item.author)}
                class="text-gray-500 hover:text-red-500 transition-colors text-xs font-bold focus:outline-none"
                title={`Block u/${item.author}`}
              >
                🚫
              </button>
            </div>

            {/* Subreddit Filter Link */}
            <span 
              onClick={() => onAddSubredditFilter(item.subreddit)}
              class="hover:text-reddit font-bold uppercase tracking-wide transition-colors cursor-pointer shrink-0"
              title={`Filter by r/${item.subreddit}`}
            >
              r/{item.subreddit}
            </span>
          </div>
        </div>

        {/* Favorite Heart Button Over Image */}
        <button 
          onClick={onToggleFavorite}
          class="absolute bottom-3 right-3 z-30 bg-black/40 hover:bg-black/60 text-white rounded-full w-8 h-8 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 shadow-sm focus:outline-none text-base"
          title={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
        >
          {isFavorite ? '❤️' : '🤍'}
        </button>
      </div>
    </div>
  );
}
