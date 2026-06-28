import React, { useState } from 'react';

export default function TagManager({
  isOpen,
  onClose,
  subreddits,
  onToggleSubreddit,
  onRemoveSubreddit,
  failedSubreddits,
  presets,
  onSavePreset,
  onDeletePreset,
  onResetToDefault
}) {
  const [activeTab, setActiveTab] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [newPresetName, setNewPresetName] = useState('');

  if (!isOpen) return null;

  // Filter logic
  let filtered = subreddits;

  // Text search
  if (searchText.trim()) {
    const q = searchText.toLowerCase().trim();
    filtered = filtered.filter(s => s.name.toLowerCase().includes(q));
  }

  // Tabs
  if (activeTab === 'active') {
    filtered = filtered.filter(s => s.active);
  } else if (activeTab === 'inactive') {
    filtered = filtered.filter(s => !s.active);
  } else if (activeTab === 'subs') {
    filtered = filtered.filter(s => !s.name.startsWith('u/'));
  } else if (activeTab === 'users') {
    filtered = filtered.filter(s => s.name.startsWith('u/'));
  }

  const handleSavePreset = (e) => {
    e.preventDefault();
    const name = newPresetName.trim();
    if (name) {
      onSavePreset(name);
      setNewPresetName('');
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div 
      onClick={handleBackdropClick}
      class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end transition-opacity duration-300"
    >
      <div class="w-full max-w-md bg-card border-l border-gray-700 h-full flex flex-col shadow-2xl p-6 text-left relative animate-fade-in">
        
        {/* Drawer Header */}
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-lg font-bold text-white flex items-center gap-2">⚙️ Manage Tags</h2>
          <button 
            onClick={onClose}
            class="text-gray-400 hover:text-white transition-colors text-2xl font-bold focus:outline-none"
          >
            &times;
          </button>
        </div>

        {/* Tab Selection */}
        <div class="flex border-b border-gray-800 mb-4 text-xs font-semibold select-none">
          {['all', 'active', 'inactive', 'subs', 'users'].map(tab => (
            <button 
              key={tab}
              onClick={() => setActiveTab(tab)}
              class={`pb-2 px-3 focus:outline-none transition-all ${
                activeTab === tab 
                  ? 'border-b-2 border-reddit text-reddit' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Search bar */}
        <input 
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          class="w-full bg-dark border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-reddit mb-4 placeholder-gray-500"
          placeholder="Filter tags by name..."
        />

        {/* Tags List Container */}
        <div class="flex-grow overflow-y-auto pr-1 flex flex-col gap-2 mb-4 scrollbar-thin">
          {filtered.length === 0 ? (
            <p class="text-xs text-gray-500 italic text-center py-8">No matching tags found</p>
          ) : (
            filtered.map(sub => {
              const isUser = sub.name.startsWith('u/');
              const isFailed = failedSubreddits.has(sub.name);
              
              return (
                <div 
                  key={sub.name}
                  onClick={() => onToggleSubreddit(sub.name)}
                  class={`flex justify-between items-center p-2.5 rounded-lg border transition-colors cursor-pointer ${
                    sub.active 
                      ? (isFailed ? 'bg-red-950/10 border-red-500/30 hover:bg-red-950/20' : 'bg-reddit/5 border-reddit/40 hover:bg-reddit/10') 
                      : 'bg-transparent border-gray-800/40 hover:bg-white/5'
                  }`}
                >
                  <div class="flex items-center gap-3 overflow-hidden">
                    <input 
                      type="checkbox"
                      checked={sub.active}
                      onChange={() => onToggleSubreddit(sub.name)}
                      class="w-4 h-4 rounded border-gray-600 text-reddit focus:ring-reddit bg-transparent cursor-pointer custom-checkbox"
                    />
                    <div class="flex flex-col text-left truncate">
                      <span class="text-sm font-semibold text-white truncate">
                        {isUser ? sub.name.substring(2) : sub.name}
                      </span>
                      <span class={`text-[9px] uppercase tracking-wider font-bold ${
                        isFailed ? 'text-red-400' : 'text-gray-500'
                      }`}>
                        {isFailed ? '⚠️ Error (Private/Banned/Typo)' : (isUser ? 'User' : 'Subreddit')}
                      </span>
                    </div>
                  </div>

                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveSubreddit(sub.name);
                    }}
                    class="text-gray-500 hover:text-red-500 px-2 py-1 transition-colors text-lg leading-none"
                    title="Remove tag"
                  >
                    &times;
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Custom Presets Drawer Footer */}
        <div class="border-t border-gray-800 pt-4 flex flex-col gap-3">
          
          {/* Preset list */}
          {Object.keys(presets).length > 0 && (
            <div>
              <p class="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-2">Saved Presets</p>
              <div class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {Object.keys(presets).map(name => (
                  <div 
                    key={name} 
                    class="bg-gray-800 border border-gray-700 text-gray-300 px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1.5"
                  >
                    <span>{name.toUpperCase()}</span>
                    <button 
                      onClick={() => onDeletePreset(name)}
                      class="text-gray-500 hover:text-red-500 font-bold"
                      title="Delete preset"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save current tag setup as preset */}
          <form onSubmit={handleSavePreset} class="flex w-full gap-2">
            <input 
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              class="flex-grow bg-dark border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-reddit placeholder-gray-500"
              placeholder="Save current setup as..."
            />
            <button 
              type="submit"
              class="bg-reddit hover:bg-reddit/80 text-white px-3 py-1.5 rounded-lg font-bold text-xs shadow transition-colors"
            >
              Save
            </button>
          </form>

          {/* Reset button */}
          <button 
            onClick={onResetToDefault}
            class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded-lg font-bold text-xs border border-gray-700 transition-colors shadow-sm"
          >
            🔄 Reset to Defaults
          </button>
        </div>

      </div>
    </div>
  );
}
