import React, { useState, useEffect } from 'react';
import Header from './components/Header.jsx';
import Grid from './components/Grid.jsx';
import Modal from './components/Modal.jsx';
import TagManager from './components/TagManager.jsx';

const DEFAULT_SUBS = [
  { name: 'highheelsnsfw', active: true },
  { name: 'secretary', active: true },
  { name: 'stockings', active: true },
  { name: 'classysexy', active: true },
  { name: 'realgirls', active: true },
  { name: 'legalteens', active: true },
  { name: 'hungrybutts', active: true },
  { name: 'classywomen', active: true }
];

const DEFAULT_PRESETS = {
  'heels': ['highheelsnsfw', 'stockings', 'classysexy', 'secretary', 'realgirls', 'legalteens', 'hungrybutts']
};

export default function App() {
  // App Settings State
  const [subreddits, setSubreddits] = useState(DEFAULT_SUBS);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [presets, setPresets] = useState(DEFAULT_PRESETS);
  const [activePreset, setActivePreset] = useState('');
  
  // App UI State
  const [items, setItems] = useState([]);
  const [cursors, setCursors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [failedSubreddits, setFailedSubreddits] = useState(new Set());
  const [selectedImages, setSelectedImages] = useState(new Set());
  
  // Views & Drawers
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [isShowingFavorites, setIsShowingFavorites] = useState(false);
  const [modalIndex, setModalIndex] = useState(-1);
  const [sortVal, setSortVal] = useState('new');

  // Download UI State
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  // Initialize and load settings from server
  useEffect(() => {
    async function initSettings() {
      console.log("[DEBUG] initSettings: Fetching settings...");
      try {
        const response = await fetch(`/api/settings?t=${Date.now()}`);
        if (response.ok) {
          const data = await response.json();
          if (data) {
            if (data.subreddits) setSubreddits(data.subreddits);
            if (data.blockedUsers) setBlockedUsers(data.blockedUsers);
            if (data.favorites) setFavorites(data.favorites);
            if (data.presets) setPresets(Object.keys(data.presets).length > 0 ? data.presets : DEFAULT_PRESETS);
          }
        }
      } catch (err) {
        console.error("[ERROR] Failed to load settings from server:", err);
      }
    }
    initSettings();
  }, []);

  // Save settings helper
  const saveSettings = async (newSubs, newFavs, newBlocks, newPresets) => {
    try {
      const payload = {
        subreddits: newSubs || subreddits,
        favorites: newFavs || favorites,
        blockedUsers: newBlocks || blockedUsers,
        presets: newPresets || presets
      };
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.error("[ERROR] Failed to save settings to server:", e);
    }
  };

  // Refresh feed whenever sortVal or subreddits list changes (excluding favorites view)
  useEffect(() => {
    if (!isShowingFavorites) {
      refreshFeed();
    }
  }, [sortVal, subreddits, isShowingFavorites]);

  // Load favorites list into main grid if isShowingFavorites is true
  useEffect(() => {
    if (isShowingFavorites) {
      setItems(favorites);
      setHasMore(false);
    }
  }, [isShowingFavorites, favorites]);

  const refreshFeed = () => {
    setCursors({});
    setItems([]);
    setFailedSubreddits(new Set());
    setSelectedImages(new Set());
    setHasMore(true);
  };

  const getProxiedImageUrl = (url) => {
    if (!url) return '';
    const allowedHosts = [
      'reddit.com', 'redditmedia.com', 'redd.it',
      'redgifs.com', 'media.redgifs.com', 'v3.redgifs.com', 'thumbs2.redgifs.com',
      'imgur.com', 'i.imgur.com'
    ];
    try {
      const parsedUrl = new URL(url);
      const isAllowed = allowedHosts.some(host => parsedUrl.hostname === host || parsedUrl.hostname.endsWith('.' + host));
      if (isAllowed) {
        return `/api/proxy?url=${encodeURIComponent(url)}`;
      }
    } catch (e) {}
    return url;
  };

  // Fetch images from active subreddits
  const fetchImages = async () => {
    const activeItems = subreddits.filter(s => s.active);
    if (activeItems.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const itemsPerSub = Math.max(10, Math.floor(40 / activeItems.length));
    
    let sortBase = sortVal;
    let timeParam = '';
    if (sortVal.startsWith('top-')) {
      sortBase = 'top';
      timeParam = `&t=${sortVal.split('-')[1]}`;
    }

    const promises = activeItems.map(async (item) => {
      if (cursors[item.name] === null) return [];
      
      const after = cursors[item.name] || '';
      let url;
      if (item.name.startsWith('u/')) {
        const username = item.name.substring(2);
        url = `https://www.reddit.com/user/${username}/submitted.json?limit=${itemsPerSub}&after=${after}&raw_json=1&include_over_18=1&sort=${sortBase}${timeParam}`;
      } else {
        url = `https://www.reddit.com/r/${item.name}/${sortBase}.json?limit=${itemsPerSub}&after=${after}&raw_json=1&include_over_18=1${timeParam}`;
      }

      try {
        const res = await fetchJsonWithFallback(url);
        // Save next cursor
        setCursors(prev => ({ ...prev, [item.name]: res.data.after }));
        return res.data.children;
      } catch (err) {
        console.error(`[ERROR] Failed to fetch ${item.name}:`, err);
        setFailedSubreddits(prev => {
          const next = new Set(prev);
          next.add(item.name);
          return next;
        });
        return [];
      }
    });

    const results = await Promise.all(promises);
    setIsLoading(false);

    let mergedPosts = [];
    let maxLength = Math.max(...results.map(arr => arr.length));
    
    for (let i = 0; i < maxLength; i++) {
      for (let j = 0; j < results.length; j++) {
        if (results[j][i]) {
          mergedPosts.push(results[j][i]);
        }
      }
    }

    const parsedItems = [];
    mergedPosts.forEach(post => {
      const postData = post.data;
      if (blockedUsers.includes(postData.author)) return;

      const targetMediaData = (postData.crosspost_parent_list && postData.crosspost_parent_list.length > 0)
        ? postData.crosspost_parent_list[0]
        : postData;

      const mediaItems = parsePostMedia(targetMediaData);
      if (mediaItems.length > 0) {
        parsedItems.push({
          id: postData.id,
          title: postData.title,
          author: postData.author,
          subreddit: postData.subreddit,
          permalink: postData.permalink,
          mediaItems: mediaItems
        });
      }
    });

    if (parsedItems.length === 0) {
      // If we loaded elements but nothing parsed, try to fetch the next pages automatically
      setHasMore(false);
    } else {
      setItems(prev => [...prev, ...parsedItems]);
    }
  };

  // Parser helper
  const parsePostMedia = (postData) => {
    const media = [];
    const url = postData.url || '';
    const title = postData.title || '';

    // 1. RedGIFs
    if (url.includes('redgifs.com/') || url.includes('v3.redgifs.com/')) {
      let gifId = url.split('/').pop().split('-')[0].split('#')[0].split('?')[0];
      if (gifId) {
        media.push({
          type: 'video',
          src: `https://media.redgifs.com/${gifId}.mp4`,
          src2: `https://media.redgifs.com/${gifId}-mobile.mp4`,
          fallbackSrc: `https://v3.redgifs.com/${gifId}.mp4`,
          fallbackSrc2: `https://v3.redgifs.com/${gifId}-mobile.mp4`,
          thumb: postData.thumbnail && postData.thumbnail.startsWith('http') ? postData.thumbnail : ''
        });
      }
      return media;
    }

    // 2. Direct Video (mp4/webm)
    if (url.match(/\.(mp4|webm)$/i)) {
      media.push({
        type: 'video',
        src: url,
        thumb: postData.thumbnail && postData.thumbnail.startsWith('http') ? postData.thumbnail : ''
      });
      return media;
    }

    // 3. Reddit native video (v.redd.it)
    if (postData.is_video && postData.media?.reddit_video?.fallback_url) {
      media.push({
        type: 'video',
        src: postData.media.reddit_video.fallback_url,
        thumb: postData.thumbnail && postData.thumbnail.startsWith('http') ? postData.thumbnail : ''
      });
      return media;
    }

    // 4. Imgur Gallery / Images
    if (url.includes('imgur.com/')) {
      if (url.match(/\.(jpg|jpeg|png|gif)$/i)) {
        media.push({ type: 'image', src: url, thumb: url });
      } else {
        const hash = url.split('/').pop().split('.')[0];
        media.push({
          type: 'image',
          src: `https://i.imgur.com/${hash}.jpg`,
          thumb: `https://i.imgur.com/${hash}.jpg`
        });
      }
      return media;
    }

    // 5. Reddit Gallary (Multi-images)
    if (postData.is_gallery && postData.media_metadata) {
      Object.keys(postData.media_metadata).forEach(key => {
        const itemMeta = postData.media_metadata[key];
        if (itemMeta.status === 'valid' && itemMeta.s) {
          const imgUrl = itemMeta.s.u ? itemMeta.s.u.replace(/&amp;/g, '&') : itemMeta.s.gif;
          if (imgUrl) {
            media.push({ type: 'image', src: imgUrl, thumb: imgUrl });
          }
        }
      });
      return media;
    }

    // 6. Direct Image URL
    if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      media.push({ type: 'image', src: url, thumb: url });
      return media;
    }

    return media;
  };

  // Helper fetch JSONP/Proxy client strategies
  const fetchJsonWithFallback = async (url) => {
    // 1. local backend
    try {
      const response = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
      if (response.ok) return await response.json();
    } catch (e) {
      console.warn("local-backend strategy failed, trying jsonp...");
    }

    // 2. jsonp fallback (direct script load)
    if (url.includes('reddit.com')) {
      return new Promise((resolve, reject) => {
        const callbackName = 'reddit_jsonp_' + Math.random().toString(36).substring(2, 11);
        const connector = url.includes('?') ? '&' : '?';
        const script = document.createElement('script');
        script.src = `${url}${connector}jsonp=${callbackName}`;
        
        window[callbackName] = (data) => {
          delete window[callbackName];
          script.remove();
          resolve(data);
        };
        script.onerror = (err) => {
          delete window[callbackName];
          script.remove();
          reject(new Error(`JSONP request to ${url} failed`));
        };
        document.body.appendChild(script);
      });
    }

    // 3. direct
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP status ${response.status}`);
    return await response.json();
  };

  // Toggle Subreddit Active state
  const handleToggleSubreddit = (name) => {
    const updated = subreddits.map(s => s.name === name ? { ...s, active: !s.active } : s);
    setSubreddits(updated);
    saveSettings(updated);
  };

  // Remove Subreddit tag
  const handleRemoveSubreddit = (name) => {
    const updated = subreddits.filter(s => s.name !== name);
    setSubreddits(updated);
    saveSettings(updated);
  };

  // Add new subreddit/username tag
  const handleAddSource = (rawName) => {
    // Input Sanitization: allow only alphanumeric, underscores, hyphens, and slashes
    const sanitized = rawName.replace(/[^a-zA-Z0-9_\-\/]/g, '').trim();
    if (!sanitized) return;

    let cleanName = sanitized;
    const isUser = sanitized.toLowerCase().startsWith('u/');
    if (!isUser) {
      cleanName = sanitized.replace(/^r\//i, '');
    } else {
      cleanName = 'u/' + sanitized.substring(2);
    }

    const exists = subreddits.find(s => s.name.toLowerCase() === cleanName.toLowerCase());
    if (!exists) {
      const updated = [...subreddits, { name: cleanName, active: true }];
      setSubreddits(updated);
      saveSettings(updated);
    } else if (!exists.active) {
      handleToggleSubreddit(exists.name);
    }
  };

  // Block a user
  const handleBlockUser = (username) => {
    if (!username) return;
    if (!blockedUsers.includes(username)) {
      const updated = [...blockedUsers, username];
      setBlockedUsers(updated);
      saveSettings(null, null, updated);
      // Immediately filter loaded items
      setItems(prev => prev.filter(item => item.author !== username));
    }
  };

  // Unblock user
  const handleUnblockUser = (username) => {
    const updated = blockedUsers.filter(u => u !== username);
    setBlockedUsers(updated);
    saveSettings(null, null, updated);
  };

  // Toggle favorite status on an item
  const handleToggleFavorite = (item) => {
    const firstMedia = item.mediaItems?.[0] || item;
    const exists = favorites.some(f => (f.mediaItems && f.mediaItems[0].src === firstMedia.src) || f.src === firstMedia.src);
    
    let updated;
    if (exists) {
      updated = favorites.filter(f => (f.mediaItems && f.mediaItems[0].src !== firstMedia.src) && f.src !== firstMedia.src);
    } else {
      updated = [...favorites, item];
    }
    setFavorites(updated);
    saveSettings(null, updated);
  };

  // Checkbox select for download
  const handleSelectImage = (url) => {
    setSelectedImages(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  // Save current tags configuration as a new preset
  const handleSavePreset = (name) => {
    const activeSubNames = subreddits.filter(s => s.active).map(s => s.name);
    if (activeSubNames.length === 0) {
      alert("No active tags to save in preset.");
      return;
    }
    const updated = { ...presets, [name]: activeSubNames };
    setPresets(updated);
    saveSettings(null, null, null, updated);
    setActivePreset(name);
  };

  // Delete preset
  const handleDeletePreset = (name) => {
    const updated = { ...presets };
    delete updated[name];
    setPresets(updated);
    saveSettings(null, null, null, updated);
    if (activePreset === name) setActivePreset('');
  };

  // Load tags from selected preset
  const handlePresetSelect = (name) => {
    setActivePreset(name);
    if (name === '') {
      // Set all active
      const updated = subreddits.map(s => ({ ...s, active: true }));
      setSubreddits(updated);
      saveSettings(updated);
    } else {
      const list = presets[name] || [];
      const updated = subreddits.map(s => ({ ...s, active: list.includes(s.name) }));
      // Append missing subreddits if they don't exist
      list.forEach(subName => {
        if (!updated.some(s => s.name.toLowerCase() === subName.toLowerCase())) {
          updated.push({ name: subName, active: true });
        }
      });
      setSubreddits(updated);
      saveSettings(updated);
    }
  };

  // Reset to default subreddits list
  const handleResetToDefault = () => {
    setSubreddits(DEFAULT_SUBS);
    setPresets(DEFAULT_PRESETS);
    setBlockedUsers([]);
    setFavorites([]);
    saveSettings(DEFAULT_SUBS, [], [], DEFAULT_PRESETS);
    refreshFeed();
  };

  // Download selected images as ZIP file (using browser JSZip from CDN)
  const handleDownloadSelected = async () => {
    const JSZip = window.JSZip;
    if (!JSZip) {
      alert("Zip utility has not finished loading. Please wait.");
      return;
    }

    const targets = Array.from(selectedImages);
    if (targets.length === 0) return;

    setIsDownloading(true);
    setDownloadStatus("Preparing files...");
    setDownloadProgress(0);

    const zip = new JSZip();
    let processed = 0;
    let errors = 0;
    const batchSize = 5;

    // Build unique URL map to find details (e.g. isVideo)
    const mediaMap = new Map();
    items.forEach(item => {
      item.mediaItems?.forEach(m => mediaMap.set(m.src, m));
    });

    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      await Promise.all(batch.map(async (url) => {
        let blob = null;
        const mediaInfo = mediaMap.get(url);
        const isVideo = mediaInfo && mediaInfo.type === 'video';

        let tryUrls = [url];
        if (mediaInfo) {
          if (mediaInfo.src2) tryUrls.push(mediaInfo.src2);
          if (mediaInfo.fallbackSrc) tryUrls.push(mediaInfo.fallbackSrc);
          if (mediaInfo.fallbackSrc2) tryUrls.push(mediaInfo.fallbackSrc2);
        }
        tryUrls = [...new Set(tryUrls)]; // unique

        const fetchStrategies = [];
        tryUrls.forEach(u => {
          fetchStrategies.push(() => fetch(u));
          fetchStrategies.push(() => fetch(`/api/proxy?url=${encodeURIComponent(u)}`));
        });

        // Loop through strategies to fetch the media file
        for (const strategy of fetchStrategies) {
          try {
            const res = await strategy();
            if (res.ok) {
              const mime = res.headers.get('content-type') || '';
              if (mime.includes('text') || mime.includes('json')) continue;
              
              const tempBlob = await res.blob();
              if (tempBlob.size >= 25000) {
                blob = tempBlob;
                break;
              }
            }
          } catch (e) {}
        }

        if (blob) {
          let filename = url.split('/').pop().split('?')[0];
          if (!filename.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm)$/i)) {
            filename += blob.type.includes('video') ? ".mp4" : ".jpg";
          }
          zip.file(filename, blob);
        } else {
          errors++;
        }

        processed++;
        const progress = Math.round((processed / targets.length) * 100);
        setDownloadProgress(progress);
        setDownloadStatus(`Processing: ${processed}/${targets.length} (Errors: ${errors})`);
      }));
    }

    if (Object.keys(zip.files).length === 0) {
      setDownloadStatus("Failed to download media files (CORS/Proxy Block).");
      setTimeout(() => setIsDownloading(false), 4000);
      return;
    }

    setDownloadStatus("Compressing archive...");
    try {
      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `reddit_gallery_${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setDownloadStatus("Download complete!");
      setSelectedImages(new Set());
    } catch (e) {
      setDownloadStatus("Compression failed.");
    }
    setTimeout(() => setIsDownloading(false), 2000);
  };

  return (
    <div class="flex flex-col min-h-screen bg-dark text-text">
      
      {/* Header controls bar */}
      <Header 
        subreddits={subreddits}
        presets={presets}
        activePreset={activePreset}
        onPresetChange={handlePresetSelect}
        sortVal={sortVal}
        onSortChange={setSortVal}
        onAddSource={handleAddSource}
        onToggleSubreddit={handleToggleSubreddit}
        onRemoveSubreddit={handleRemoveSubreddit}
        onOpenTagManager={() => setIsTagManagerOpen(true)}
        favoritesCount={favorites.length}
        isShowingFavorites={isShowingFavorites}
        onToggleShowingFavorites={() => setIsShowingFavorites(!isShowingFavorites)}
        onDownloadSelected={handleDownloadSelected}
        selectedCount={selectedImages.size}
        blockedUsers={blockedUsers}
        onUnblockUser={handleUnblockUser}
        failedSubreddits={failedSubreddits}
      />

      {/* Batch Download Progress Status Bar */}
      {isDownloading && (
        <div class="bg-card border-b border-gray-800 p-3 text-center z-30 transition-all select-none">
          <div class="max-w-md mx-auto">
            <p class="text-xs font-semibold text-gray-300 mb-1">{downloadStatus}</p>
            <div class="w-full bg-dark rounded-full h-1.5 overflow-hidden border border-gray-800">
              <div class="bg-green-500 h-1.5 transition-all duration-300" style={{ width: `${downloadProgress}%` }}></div>
            </div>
          </div>
        </div>
      )}

      {/* Masonry Columns Feed Grid */}
      <Grid 
        items={items}
        getProxiedImageUrl={getProxiedImageUrl}
        favorites={favorites}
        onToggleFavorite={handleToggleFavorite}
        onBlockUser={handleBlockUser}
        onSelectImage={handleSelectImage}
        selectedImages={selectedImages}
        onCardClick={(idx) => setModalIndex(idx)}
        onAddSubredditFilter={handleAddSource}
        isLoading={isLoading}
        onLoadMore={fetchImages}
        hasMore={hasMore}
      />

      {/* Settings Tag Manager Drawer */}
      <TagManager 
        isOpen={isTagManagerOpen}
        onClose={() => setIsTagManagerOpen(false)}
        subreddits={subreddits}
        onToggleSubreddit={handleToggleSubreddit}
        onRemoveSubreddit={handleRemoveSubreddit}
        failedSubreddits={failedSubreddits}
        presets={presets}
        onSavePreset={handleSavePreset}
        onDeletePreset={handleDeletePreset}
        onResetToDefault={handleResetToDefault}
      />

      {/* Full-screen Media Modal Player */}
      {modalIndex >= 0 && (
        <Modal 
          items={items}
          currentIndex={modalIndex}
          onClose={() => setModalIndex(-1)}
          onNavigate={(dir) => {
            const nextIdx = modalIndex + dir;
            if (nextIdx >= 0 && nextIdx < items.length) {
              setModalIndex(nextIdx);
            }
          }}
          getProxiedImageUrl={getProxiedImageUrl}
          isFavorite={favorites.some(f => {
            const first = items[modalIndex]?.mediaItems?.[0] || items[modalIndex];
            return (f.mediaItems && f.mediaItems[0].src === first?.src) || f.src === first?.src;
          })}
          onToggleFavorite={() => handleToggleFavorite(items[modalIndex])}
          isAutoplaying={false} // Autoplay toggle is handled natively inside Modal
          onToggleAutoplay={() => {}}
          autoplayDuration={10}
        />
      )}
    </div>
  );
}
