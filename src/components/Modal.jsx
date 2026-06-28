import React, { useState, useEffect, useRef } from 'react';

export default function Modal({
  items,
  currentIndex,
  onClose,
  onNavigate,
  getProxiedImageUrl,
  isFavorite,
  onToggleFavorite,
  isAutoplaying,
  onToggleAutoplay,
  autoplayDuration
}) {
  const item = items[currentIndex];
  if (!item) return null;

  const firstMedia = item.mediaItems?.[0] || item;
  
  // Set up video sources (prioritizing local proxy for RedGIFs)
  const getVideoSources = () => {
    if (firstMedia.src && firstMedia.src.includes('redgifs.com')) {
      return [
        `/api/proxy?url=${encodeURIComponent(firstMedia.src)}`,
        firstMedia.src,
        firstMedia.src2,
        firstMedia.fallbackSrc,
        firstMedia.fallbackSrc2
      ].filter(v => !!v);
    }
    return [
      firstMedia.src,
      firstMedia.src2,
      firstMedia.fallbackSrc,
      firstMedia.fallbackSrc2,
      firstMedia.src ? `/api/proxy?url=${encodeURIComponent(firstMedia.src)}` : null
    ].filter(v => !!v);
  };

  const videoSources = getVideoSources();
  const [videoSrcIdx, setVideoSrcIdx] = useState(0);
  const [isVideoFailed, setIsVideoFailed] = useState(false);

  // Set up image options
  const imgOptions = [
    getProxiedImageUrl(firstMedia.src),
    firstMedia.src
  ].filter(v => !!v);

  const [imgSrcIdx, setImgSrcIdx] = useState(0);
  const [isImgFailed, setIsImgFailed] = useState(false);

  const videoRef = useRef(null);

  // Reset indices whenever the current index or item changes
  useEffect(() => {
    setVideoSrcIdx(0);
    setIsVideoFailed(false);
    setImgSrcIdx(0);
    setIsImgFailed(false);
  }, [currentIndex, item]);

  // Handle keydown navigation (Left, Right, Escape)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onNavigate(-1);
      else if (e.key === 'ArrowRight') onNavigate(1);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onNavigate]);

  // Handle Autoplay timer
  useEffect(() => {
    if (!isAutoplaying) return;

    let timer;
    if (firstMedia.type === 'video') {
      // For videos, wait until metadata is loaded to know the duration
      const handleMetadata = () => {
        if (!videoRef.current) return;
        const duration = videoRef.current.duration;
        const waitTime = Math.max(autoplayDuration * 1000, (isNaN(duration) || !isFinite(duration)) ? 0 : duration * 1000);
        timer = setTimeout(() => onNavigate(1), waitTime);
      };
      
      const vid = videoRef.current;
      if (vid) {
        vid.addEventListener('loadedmetadata', handleMetadata);
        // If already loaded
        if (vid.readyState >= 1) handleMetadata();
      }
      return () => {
        if (vid) vid.removeEventListener('loadedmetadata', handleMetadata);
        clearTimeout(timer);
      };
    } else {
      // For images, transition after the set duration
      timer = setTimeout(() => onNavigate(1), autoplayDuration * 1000);
      return () => clearTimeout(timer);
    }
  }, [isAutoplaying, currentIndex, firstMedia.type, autoplayDuration, onNavigate]);

  // Video error failover handler
  const handleVideoError = () => {
    if (videoSrcIdx < videoSources.length - 1) {
      console.log(`Video source failed, trying next: ${videoSources[videoSrcIdx + 1]}`);
      setVideoSrcIdx(videoSrcIdx + 1);
    } else {
      console.error("All video sources failed in modal");
      setIsVideoFailed(true);
    }
  };

  // Image error failover handler
  const handleImageError = () => {
    if (imgSrcIdx < imgOptions.length - 1) {
      setImgSrcIdx(imgSrcIdx + 1);
    } else {
      setIsImgFailed(true);
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const captionText = items.length > 1 ? `${item.title} (${currentIndex + 1}/${items.length})` : item.title;

  return (
    <div 
      onClick={handleBackdropClick}
      class="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 transition-all duration-300 animate-fade-in"
    >
      {/* Navigation Left Button */}
      {items.length > 1 && (
        <button 
          onClick={() => onNavigate(-1)}
          class="absolute left-6 text-white/50 hover:text-white transition-all text-4xl p-4 z-50 focus:outline-none"
        >
          &#10094;
        </button>
      )}

      {/* Main Content Area */}
      <div class="max-w-5xl max-h-[85vh] flex items-center justify-center relative overflow-hidden">
        
        {firstMedia.type === 'video' && !isVideoFailed ? (
          <video 
            ref={videoRef}
            src={videoSources[videoSrcIdx]}
            onError={handleVideoError}
            controls
            autoPlay
            loop
            playsInline
            class="max-w-full max-h-[80vh] rounded-lg shadow-2xl transition-all duration-300 scale-100"
          />
        ) : (
          <img 
            src={isImgFailed ? 'https://placehold.co/600x400/272729/D7DADC?text=Image+Load+Failed' : imgOptions[imgSrcIdx]}
            onError={handleImageError}
            alt={item.title}
            class="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl transition-all duration-300 scale-100"
          />
        )}
      </div>

      {/* Navigation Right Button */}
      {items.length > 1 && (
        <button 
          onClick={() => onNavigate(1)}
          class="absolute right-6 text-white/50 hover:text-white transition-all text-4xl p-4 z-50 focus:outline-none"
        >
          &#10095;
        </button>
      )}

      {/* Close button */}
      <button 
        onClick={onClose}
        class="absolute top-4 right-6 text-white/50 hover:text-white transition-all text-3xl font-bold p-4 z-50 focus:outline-none"
      >
        &times;
      </button>

      {/* Bottom Info & Controls Bar */}
      <div class="absolute bottom-4 left-0 right-0 text-center px-4 flex flex-col items-center gap-2 select-none">
        
        {/* Caption Label & Favorites Toggle */}
        <div class="bg-black/60 backdrop-blur-sm border border-gray-800 text-white py-2 px-6 rounded-full text-xs font-semibold max-w-2xl flex items-center gap-3 shadow-lg">
          <span class="truncate">{captionText}</span>
          <button 
            onClick={onToggleFavorite}
            class="hover:scale-125 transition-transform text-sm focus:outline-none"
            title={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
          >
            {isFavorite ? '❤️' : '🤍'}
          </button>
        </div>

        {/* Autoplay Slideshow Panel */}
        <div class="flex items-center gap-2 bg-black/60 backdrop-blur-sm border border-gray-800 py-1.5 px-4 rounded-full text-xs text-gray-300 shadow-md">
          <button 
            onClick={onToggleAutoplay}
            class={`font-semibold focus:outline-none px-2.5 py-0.5 rounded transition-all ${
              isAutoplaying ? 'bg-reddit text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'
            }`}
          >
            {isAutoplaying ? '⏸ Pause Autoplay' : '▶ Autoplay'}
          </button>
          
          {isAutoplaying && (
            <span class="text-[10px] text-gray-500 font-medium">
              (Video completes OR {autoplayDuration}s image timer)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
