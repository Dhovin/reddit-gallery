import React, { useState } from 'react';

export default function Header({
  subreddits,
  presets,
  activePreset,
  onPresetChange,
  sortVal,
  onSortChange,
  onAddSource,
  onToggleSubreddit,
  onRemoveSubreddit,
  onOpenTagManager,
  favoritesCount,
  isShowingFavorites,
  onToggleShowingFavorites,
  onDownloadSelected,
  selectedCount,
  blockedUsers,
  onUnblockUser,
  failedSubreddits
}) {
  const [inputValue, setInputValue] = useState('');
  const [isBlockedOpen, setIsBlockedOpen] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    const val = inputValue.trim();
    if (val) {
      onAddSource(val);
      setInputValue('');
    }
  };

  const activeSubs = subreddits.filter(s => s.active);

  return (
    <header class="sticky top-0 z-40 bg-card/95 backdrop-blur-sm border-b border-gray-700 shadow-lg p-4">
      <div class="max-w-7xl mx-auto flex flex-col gap-3">
        
        {/* Top Row: Logo, Input, Actions */}
        <div class="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between w-full">
          
          {/* Logo */}
          <div 
            class="flex items-center gap-2 cursor-pointer flex-shrink-0" 
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <div class="w-8 h-8 bg-reddit rounded-full flex items-center justify-center text-white font-bold text-lg select-none">r/</div>
            <h1 class="text-xl font-bold text-white tracking-tight hidden sm:block">Gallery</h1>
          </div>

          {/* Search/Add Input */}
          <form onSubmit={handleSubmit} class="flex w-full gap-2 relative">
            <input 
              type="text" 
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              class="flex-grow bg-[#1A1A1B] border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-reddit focus:ring-1 focus:ring-reddit transition-all text-white placeholder-gray-500 text-sm"
              placeholder="Add subreddit (e.g. cozyplaces) or user (e.g. u/username)"
            />
            <button 
              type="submit"
              class="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors shadow-md text-sm"
              title="Add to list"
            >
              +
            </button>
          </form>

          {/* Quick Action Buttons */}
          <div class="flex gap-2 items-center flex-shrink-0 w-full md:w-auto justify-end">
            <button 
              onClick={onOpenTagManager}
              class="bg-gray-800 hover:bg-gray-700 text-white px-3.5 py-2 rounded-lg font-medium transition-all text-xs border border-gray-700 flex items-center gap-2 relative shadow-sm"
            >
              ⚙️ Manage Tags
              <span class="bg-reddit text-white rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                {subreddits.length}
              </span>
            </button>

            <button 
              onClick={onToggleShowingFavorites}
              class={`px-3.5 py-2 rounded-lg font-medium transition-all text-xs border flex items-center gap-1.5 shadow-sm ${
                isShowingFavorites 
                  ? 'bg-reddit border-reddit text-white' 
                  : 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-white'
              }`}
            >
              ❤️ Favorites
              <span class={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                isShowingFavorites ? 'bg-white text-reddit' : 'bg-reddit text-white'
              }`}>
                {favoritesCount}
              </span>
            </button>

            {selectedCount > 0 && (
              <button 
                onClick={onDownloadSelected}
                class="bg-green-600 hover:bg-green-500 text-white px-3.5 py-2 rounded-lg font-medium transition-all text-xs shadow-md flex items-center gap-1.5"
              >
                📥 Download ({selectedCount})
              </button>
            )}
          </div>
        </div>

        {/* Second Row: Presets, Sort, Chips */}
        <div class="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between w-full border-t border-gray-800 pt-3">
          
          {/* Preset & Sort Selectors */}
          <div class="flex gap-2 items-center flex-shrink-0">
            <div class="flex items-center bg-gray-800 border border-gray-700 rounded-lg px-2 text-xs">
              <span class="text-gray-400 mr-1 select-none text-[10px] uppercase font-bold tracking-wider">Preset:</span>
              <select 
                value={activePreset} 
                onChange={(e) => onPresetChange(e.target.value)}
                class="bg-transparent border-none text-white focus:outline-none py-1.5 pr-2 font-semibold cursor-pointer"
              >
                <option class="bg-dark" value="">All Tags</option>
                {Object.keys(presets).map(name => (
                  <option class="bg-dark" key={name} value={name}>{name.toUpperCase()}</option>
                ))}
              </select>
            </div>

            <div class="flex items-center bg-gray-800 border border-gray-700 rounded-lg px-2 text-xs">
              <span class="text-gray-400 mr-1 select-none text-[10px] uppercase font-bold tracking-wider">Sort:</span>
              <select 
                value={sortVal} 
                onChange={(e) => onSortChange(e.target.value)}
                class="bg-transparent border-none text-white focus:outline-none py-1.5 pr-2 font-semibold cursor-pointer"
              >
                <option class="bg-dark" value="new">NEW</option>
                <option class="bg-dark" value="hot">HOT</option>
                <option class="bg-dark" value="top-day">TOP (Day)</option>
                <option class="bg-dark" value="top-week">TOP (Week)</option>
                <option class="bg-dark" value="top-month">TOP (Month)</option>
                <option class="bg-dark" value="top-year">TOP (Year)</option>
                <option class="bg-dark" value="top-all">TOP (All)</option>
              </select>
            </div>
          </div>

          {/* Scrollable Active Chips List */}
          <div class="flex-grow overflow-x-auto scrollbar-none flex gap-1.5 items-center px-1 py-0.5 justify-start">
            {activeSubs.length === 0 ? (
              <span class="text-xs text-gray-500 italic py-1 px-2 select-none">No active sources</span>
            ) : (
              activeSubs.map(sub => {
                const isUser = sub.name.startsWith('u/');
                const isFailed = failedSubreddits.has(sub.name);
                const displayLabel = isUser ? `u/${sub.name.substring(2)}` : `r/${sub.name}`;
                
                return (
                  <div 
                    key={sub.name}
                    onClick={() => onToggleSubreddit(sub.name)}
                    class={`px-3 py-1 rounded-full text-xs font-semibold cursor-pointer transition-all border flex items-center gap-1.5 select-none shrink-0 ${
                      isFailed 
                        ? 'bg-red-950/20 border-red-500/50 text-red-400 hover:bg-red-950/30' 
                        : 'bg-reddit/20 border-reddit text-reddit hover:bg-reddit/30'
                    }`}
                  >
                    <span>{isFailed ? '⚠️ ' : ''}{displayLabel}</span>
                    <span 
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSubreddit(sub.name);
                      }}
                      class={`w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-white/20 leading-none pb-0.5 font-bold text-sm ${
                        isFailed ? 'text-red-400' : 'text-reddit'
                      }`}
                    >
                      &times;
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Blocked Users Section (Togglable) */}
        {blockedUsers.length > 0 && (
          <div class="border-t border-gray-800 pt-2 text-left">
            <button 
              onClick={() => setIsBlockedOpen(!isBlockedOpen)}
              class="text-xs text-gray-400 hover:text-white flex items-center gap-1 font-semibold transition-colors focus:outline-none"
            >
              <span class={`inline-block transition-transform duration-200 ${isBlockedOpen ? 'rotate-90' : 'rotate-0'}`}>
                ▶
              </span>
              Blocked Users ({blockedUsers.length})
            </button>
            
            {isBlockedOpen && (
              <div class="flex flex-wrap gap-1.5 mt-2 bg-black/20 p-2.5 rounded-lg border border-gray-800/80 max-h-24 overflow-y-auto">
                {blockedUsers.map(user => (
                  <div 
                    key={user} 
                    class="bg-gray-800/60 border border-gray-700 text-gray-300 px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1"
                  >
                    <span>u/{user}</span>
                    <span 
                      onClick={() => onUnblockUser(user)} 
                      class="cursor-pointer hover:text-white font-bold text-sm leading-none pb-0.5 px-0.5"
                    >
                      &times;
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </header>
  );
}
