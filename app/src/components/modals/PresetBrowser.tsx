/* ============================================================
   PRESET BROWSER — PART 1: Imports, Types, Small Sub-components

   A full-featured arrangement browser with two tabs:
   1. GUIDED PATH — Built-in presets organized into progressive
      stages from 2-voice basics to 6-voice jazz ensemble.
   2. MY LIBRARY — User-created and downloaded arrangements
      stored in IndexedDB with folder organization and search.
   ============================================================ */

import { useState, useEffect, useCallback } from 'react';
import {
  X, Search, FolderPlus, Trash2, ChevronRight,
  Music, Play, Heart, Save, Upload,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { useAppStore } from '../../stores/appStore';
import { guidedPath } from '../../data/presets/guidedPath';
import { sampleArrangements } from '../../data/arrangements';
import { LibraryService } from '../../services/LibraryService';
import type { Arrangement } from '../../types';
import type { LibraryTab, LibraryFolder, LibraryItem, GuidedStage } from '../../types/library';

/* ============================================================
   SMALL REUSABLE SUB-COMPONENTS
   ============================================================ */

/* -- Difficulty Dots: shows 1-5 filled dots -- */
function DifficultyDots({ level }: { level: number }) {
  return (
    <div className="flex gap-0.5" title={`Difficulty ${level}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full transition-colors ${
            i <= level ? 'bg-[var(--accent-primary)]' : 'bg-[var(--button-bg)]'
          }`}
        />
      ))}
    </div>
  );
}

/* -- Voice Color Strip: tiny colored bars showing the voices -- */
function VoiceColorStrip({ voices }: { voices: Arrangement['voices'] }) {
  return (
    <div className="flex gap-0.5">
      {voices.map((v) => (
        <div
          key={v.id}
          className="w-5 h-1 rounded-full"
          style={{ backgroundColor: v.color }}
          title={v.name}
        />
      ))}
    </div>
  );
}

/* ============================================================
   ARRANGEMENT ROW — compact row used in both tabs
   ============================================================ */

interface ArrangementRowProps {
  arrangement: Arrangement;
  isSelected: boolean;
  onSelect: () => void;
  accentColor?: string;
  onFavorite?: () => void;
  onDelete?: () => void;
  isFavorite?: boolean;
}

function ArrangementRow({
  arrangement, isSelected, onSelect, accentColor,
  onFavorite, onDelete, isFavorite,
}: ArrangementRowProps) {
  return (
    <div
      className={`
        group relative flex items-center gap-3 p-2.5 rounded-[var(--radius-sm)]
        border transition-all duration-150 cursor-pointer
        ${isSelected
          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 shadow-[0_0_12px_var(--accent-primary-glow)]'
          : 'border-transparent hover:bg-[var(--button-bg-hover)]'}
      `}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
    >
      {/* Play icon / selected indicator */}
      <div
        className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
        style={{
          background: isSelected
            ? 'var(--accent-primary)'
            : accentColor ? `${accentColor}22` : 'var(--button-bg)',
        }}
      >
        {isSelected
          ? <Play size={12} className="text-white ml-0.5" fill="currentColor" />
          : <Music size={12} style={{ color: accentColor || 'var(--text-muted)' }} />}
      </div>

      {/* Title + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-primary)] truncate">
            {arrangement.title}
          </span>
          <DifficultyDots level={arrangement.difficulty ?? 1} />
        </div>
        {arrangement.description && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
            {arrangement.description}
          </p>
        )}
      </div>

      {/* Metadata pills */}
      <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] text-[var(--text-disabled)]">{arrangement.voices.length}v</span>
        <span className="text-[10px] text-[var(--text-disabled)]">{arrangement.bars}b</span>
        <span className="text-[10px] text-[var(--text-disabled)]">{arrangement.tempo}bpm</span>
        <VoiceColorStrip voices={arrangement.voices} />
      </div>

      {/* Action buttons (My Library items only) — show on hover */}
      {(onFavorite || onDelete) && (
        <div className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
          {onFavorite && (
            <button
              onClick={(e) => { e.stopPropagation(); onFavorite(); }}
              className="p-1 rounded-full hover:bg-[var(--button-bg-hover)] transition-colors"
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart size={13} className={isFavorite ? 'text-[var(--accent-secondary)] fill-current' : 'text-[var(--text-disabled)]'} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded-full hover:bg-red-500/20 transition-colors"
              title="Delete"
            >
              <Trash2 size={13} className="text-[var(--text-disabled)] hover:text-red-400" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   STAGE CARD — accordion header + arrangement list
   ============================================================ */

interface StageCardProps {
  stage: GuidedStage;
  isExpanded: boolean;
  onToggle: () => void;
  currentArrangementId: string | undefined;
  onSelect: (arrangement: Arrangement) => void;
}

function StageCard({ stage, isExpanded, onToggle, currentArrangementId, onSelect }: StageCardProps) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-color)] overflow-hidden transition-all duration-200">
      {/* Stage header — always visible, clickable to expand */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 hover:bg-[var(--button-bg-hover)] transition-colors cursor-pointer text-left"
      >
        {/* Stage number badge */}
        <div
          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-lg"
          style={{
            background: `linear-gradient(135deg, ${stage.color}, ${stage.color}88)`,
            boxShadow: `0 0 12px ${stage.color}40`,
          }}
        >
          {stage.number}
        </div>

        {/* Stage info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-[var(--text-primary)] truncate">
              {stage.icon} {stage.title}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--button-bg)] text-[var(--text-muted)] whitespace-nowrap">
              {stage.voiceCount} voices
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{stage.subtitle}</p>
        </div>

        {/* Arrangement count + chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-[var(--text-disabled)]">{stage.arrangements.length}</span>
          <ChevronRight
            size={14}
            className={`text-[var(--text-disabled)] transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
          />
        </div>
      </button>

      {/* Expanded arrangement list */}
      {isExpanded && (
        <div className="border-t border-[var(--border-color)] bg-black/10 p-2 grid gap-1.5">
          {stage.arrangements.map((arr) => (
            <ArrangementRow
              key={arr.id}
              arrangement={arr}
              isSelected={currentArrangementId === arr.id}
              onSelect={() => onSelect(arr)}
              accentColor={stage.color}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   GUIDED PATH TAB
   ============================================================ */

interface GuidedPathTabProps {
  currentArrangementId: string | undefined;
  onSelect: (arrangement: Arrangement) => void;
}

function GuidedPathTab({ currentArrangementId, onSelect }: GuidedPathTabProps) {
  const [expandedStage, setExpandedStage] = useState<string | null>(guidedPath[0]?.id ?? null);

  return (
    <div className="space-y-3 p-1">
      <p className="text-xs text-[var(--text-muted)] leading-relaxed px-1">
        Work through these stages to build your harmony singing skills
        from simple two-voice intervals all the way to six-part jazz.
      </p>

      {guidedPath.map((stage) => (
        <StageCard
          key={stage.id}
          stage={stage}
          isExpanded={expandedStage === stage.id}
          onToggle={() => setExpandedStage(expandedStage === stage.id ? null : stage.id)}
          currentArrangementId={currentArrangementId}
          onSelect={onSelect}
        />
      ))}

      {/* Legacy / other presets */}
      {sampleArrangements.length > 0 && (
        <>
          <div className="flex items-center gap-3 pt-3">
            <div className="flex-1 h-px bg-[var(--border-color)]" />
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-disabled)]">Other Presets</span>
            <div className="flex-1 h-px bg-[var(--border-color)]" />
          </div>
          <div className="grid gap-2">
            {sampleArrangements.map((arr) => (
              <ArrangementRow
                key={arr.id}
                arrangement={arr}
                isSelected={currentArrangementId === arr.id}
                onSelect={() => onSelect(arr)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ============================================================
   MY LIBRARY TAB
   ============================================================ */

interface MyLibraryTabProps {
  currentArrangementId: string | undefined;
  onSelect: (arrangement: Arrangement) => void;
  currentArrangement: Arrangement | null;
}

function MyLibraryTab({ currentArrangementId, onSelect, currentArrangement }: MyLibraryTabProps) {
  /* ---- State ---- */
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [fileInputEl, setFileInputEl] = useState<HTMLInputElement | null>(null);

  /* ---- Load library from IndexedDB on mount ---- */
  const loadLibrary = useCallback(async () => {
    setIsLoading(true);
    const [loadedItems, loadedFolders] = await Promise.all([
      LibraryService.getAllItems(),
      LibraryService.getAllFolders(),
    ]);
    setItems(loadedItems);
    setFolders(loadedFolders);
    setIsLoading(false);
  }, []);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  /* ---- Filter items by search + active folder ---- */
  const filteredItems = items.filter((item) => {
    /* Folder filter */
    if (activeFolderId === '__favorites__') {
      if (!item.isFavorite) return false;
    } else if (activeFolderId !== null) {
      if (item.folderId !== activeFolderId) return false;
    }
    /* Search filter */
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const a = item.arrangement;
      if (
        !a.title.toLowerCase().includes(q) &&
        !(a.description ?? '').toLowerCase().includes(q) &&
        !(a.tags ?? []).some((t) => t.toLowerCase().includes(q))
      ) return false;
    }
    return true;
  });

  /* ---- Actions ---- */
  const handleSaveCurrent = async () => {
    if (!currentArrangement) return;
    await LibraryService.saveArrangement(currentArrangement, activeFolderId === '__favorites__' ? null : activeFolderId);
    await loadLibrary();
  };

  const handleImportClick = () => {
    setImportStatus(null);
    fileInputEl?.click();
  };

  const handleImportFile = async (file: File) => {
    setImportStatus(null);

    // Read the selected file and parse it as JSON.
    let parsed: unknown;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch {
      setImportStatus({ type: 'error', message: 'That file is not valid JSON.' });
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      setImportStatus({ type: 'error', message: 'That JSON file does not look like an arrangement.' });
      return;
    }

    const candidate = parsed as Partial<Arrangement>;

    const hasRequiredFields =
      typeof candidate.id === 'string'
      && typeof candidate.title === 'string'
      && typeof candidate.tonic === 'string'
      && typeof candidate.scale === 'string'
      && typeof candidate.tempo === 'number'
      && typeof candidate.bars === 'number'
      && typeof candidate.timeSig === 'object'
      && candidate.timeSig !== null
      && typeof (candidate.timeSig as any).numerator === 'number'
      && typeof (candidate.timeSig as any).denominator === 'number'
      && Array.isArray(candidate.voices);

    if (!hasRequiredFields) {
      setImportStatus({
        type: 'error',
        message: 'This JSON file is missing required arrangement fields (id, title, key, timing, voices).',
      });
      return;
    }

    // At this point, we've validated the required fields at runtime.
    // We copy them into strongly-typed variables so TypeScript knows they are not undefined.
    const id: string = candidate.id as string;
    const title: string = candidate.title as string;
    const tonic: string = candidate.tonic as string;
    const tempo: number = candidate.tempo as number;
    const bars: number = candidate.bars as number;
    const timeSig: Arrangement['timeSig'] = candidate.timeSig as Arrangement['timeSig'];
    const voices: Arrangement['voices'] = candidate.voices as Arrangement['voices'];

    const importedArrangement: Arrangement = {
      id,
      title,
      description: candidate.description,
      tonic,
      scale: candidate.scale as Arrangement['scale'],
      tempo,
      bars,
      timeSig,
      voices,
      chords: candidate.chords as Arrangement['chords'],
      difficulty: candidate.difficulty,
      tags: candidate.tags,
      author: candidate.author,
      createdAt: candidate.createdAt,
    };

    const existingArrangementIds = new Set(items.map((it) => it.arrangement.id));
    if (existingArrangementIds.has(importedArrangement.id)) {
      importedArrangement.id = `${importedArrangement.id}_import_${Date.now()}`;
    }

    try {
      await LibraryService.saveArrangement(
        importedArrangement,
        activeFolderId === '__favorites__' ? null : activeFolderId,
        'user',
      );
      await loadLibrary();
      setImportStatus({ type: 'success', message: `Imported “${importedArrangement.title}”` });
    } catch {
      setImportStatus({ type: 'error', message: 'Import failed while saving to your library.' });
    }
  };

  const handleDelete = async (itemId: string) => {
    await LibraryService.deleteItem(itemId);
    await loadLibrary();
  };

  const handleToggleFavorite = async (itemId: string) => {
    await LibraryService.toggleFavorite(itemId);
    await loadLibrary();
  };

  const handleCreateFolder = async () => {
    const name = prompt('New folder name:');
    if (!name?.trim()) return;
    await LibraryService.createFolder(name.trim());
    await loadLibrary();
  };

  const handleDeleteFolder = async (folderId: string) => {
    await LibraryService.deleteFolder(folderId);
    if (activeFolderId === folderId) setActiveFolderId(null);
    await loadLibrary();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar: search + save + new folder */}
      <div className="flex items-center gap-2 p-2 border-b border-[var(--border-color)]">
        <input
          ref={(el) => setFileInputEl(el)}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void handleImportFile(file);
            e.target.value = '';
          }}
        />

        {/* Search */}
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" />
          <input
            type="text"
            placeholder="Search arrangements..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-xs rounded-[var(--radius-sm)] bg-[var(--button-bg)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-disabled)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
          />
        </div>
        {/* Save current arrangement */}
        <Button size="sm" variant="default" onClick={handleSaveCurrent} disabled={!currentArrangement} title="Save current arrangement to library">
          <Save size={14} className="mr-1" /> Save
        </Button>
        {/* Import arrangement */}
        <Button size="sm" variant="ghost" onClick={handleImportClick} title="Import a .json arrangement into your library">
          <Upload size={14} className="mr-1" /> Import
        </Button>
        {/* New folder */}
        <Button size="sm" variant="ghost" onClick={handleCreateFolder} title="Create folder">
          <FolderPlus size={14} />
        </Button>
      </div>

      {importStatus && (
        <div className="px-3 py-1 border-b border-[var(--border-color)]">
          <p
            className={`text-[11px] ${importStatus.type === 'error' ? 'text-red-300' : 'text-[var(--text-muted)]'}`}
            role={importStatus.type === 'error' ? 'alert' : undefined}
          >
            {importStatus.message}
          </p>
        </div>
      )}

      {/* Body: sidebar + list */}
      <div className="flex flex-1 overflow-hidden">
        {/* Folder sidebar */}
        <div className="w-36 border-r border-[var(--border-color)] overflow-y-auto p-1.5 space-y-0.5 flex-shrink-0">
          {/* All */}
          <button
            onClick={() => setActiveFolderId(null)}
            className={`w-full text-left text-xs px-2 py-1.5 rounded-[var(--radius-sm)] truncate transition-colors cursor-pointer ${
              activeFolderId === null ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--button-bg-hover)]'
            }`}
          >
            All ({items.length})
          </button>
          {/* Favorites */}
          <button
            onClick={() => setActiveFolderId('__favorites__')}
            className={`w-full text-left text-xs px-2 py-1.5 rounded-[var(--radius-sm)] truncate flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeFolderId === '__favorites__' ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--button-bg-hover)]'
            }`}
          >
            <Heart size={11} /> Favorites
          </button>
          {/* User folders */}
          {folders.map((f) => (
            <div key={f.id} className="group flex items-center">
              <button
                onClick={() => setActiveFolderId(f.id)}
                className={`flex-1 text-left text-xs px-2 py-1.5 rounded-[var(--radius-sm)] truncate transition-colors cursor-pointer ${
                  activeFolderId === f.id ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--button-bg-hover)]'
                }`}
              >
                {f.name}
              </button>
              <button
                onClick={() => handleDeleteFolder(f.id)}
                className="hidden group-hover:block p-0.5 rounded hover:bg-red-500/20 transition-colors"
                title="Delete folder"
              >
                <Trash2 size={10} className="text-[var(--text-disabled)]" />
              </button>
            </div>
          ))}
        </div>

        {/* Items list */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <p className="text-xs text-[var(--text-muted)] text-center py-8">Loading...</p>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-[var(--text-muted)]">No arrangements yet</p>
              <p className="text-xs text-[var(--text-disabled)] mt-1">
                Save arrangements from Create mode or download from the community
              </p>
            </div>
          ) : (
            <div className="grid gap-1.5">
              {filteredItems.map((item) => (
                <ArrangementRow
                  key={item.id}
                  arrangement={item.arrangement}
                  isSelected={currentArrangementId === item.arrangement.id}
                  onSelect={() => onSelect(item.arrangement)}
                  isFavorite={item.isFavorite}
                  onFavorite={() => handleToggleFavorite(item.id)}
                  onDelete={() => handleDelete(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   MAIN EXPORT: LibraryModal (Preset Browser)
   ============================================================ */

export function LibraryModal() {
  /* ---- Store state ---- */
  const isOpen = useAppStore((s) => s.isLibraryOpen);
  const currentArrangement = useAppStore((s) => s.arrangement);
  const setLibraryOpen = useAppStore((s) => s.setLibraryOpen);
  const setArrangement = useAppStore((s) => s.setArrangement);

  /* ---- Local state ---- */
  const [activeTab, setActiveTab] = useState<LibraryTab>('guided');

  if (!isOpen) return null;

  /* ---- Handlers ---- */
  const handleSelect = (arrangement: Arrangement) => {
    setArrangement(arrangement);
    setLibraryOpen(false);
  };

  const handleClose = () => setLibraryOpen(false);

  /* ---- Tab definitions ---- */
  const tabs: { id: LibraryTab; label: string; icon: React.ReactNode }[] = [
    { id: 'guided', label: 'Guided Path', icon: <ChevronRight size={14} /> },
    { id: 'myLibrary', label: 'My Library', icon: <Heart size={14} /> },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-lg animate-[fadeInUp_0.15s_ease-out]"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Preset Browser"
    >
      <Panel
        variant="solid"
        className="w-full max-w-3xl h-[85vh] max-h-[720px] m-4 flex flex-col animate-[fadeInUp_0.25s_ease-out] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---- Header ---- */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
          {/* Title */}
          <h2 className="text-base font-bold text-[var(--text-primary)] tracking-tight">
            Arrangements
          </h2>

          {/* Tab switcher */}
          <div className="flex items-center gap-1 bg-[var(--button-bg)] rounded-full p-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-150 cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-[var(--accent-primary)] text-white shadow-[0_0_10px_var(--accent-primary-glow)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Close button */}
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <X size={18} />
          </Button>
        </div>

        {/* ---- Tab Content ---- */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'guided' ? (
            <div className="p-4">
              <GuidedPathTab
                currentArrangementId={currentArrangement?.id}
                onSelect={handleSelect}
              />
            </div>
          ) : (
            <MyLibraryTab
              currentArrangementId={currentArrangement?.id}
              onSelect={handleSelect}
              currentArrangement={currentArrangement}
            />
          )}
        </div>

        {/* ---- Footer ---- */}
        <div className="px-5 py-2 border-t border-[var(--border-color)] flex items-center justify-between">
          <span className="text-[10px] text-[var(--text-disabled)]">
            {activeTab === 'guided'
              ? `${guidedPath.reduce((n, s) => n + s.arrangements.length, 0)} guided arrangements across ${guidedPath.length} stages`
              : 'Save arrangements from Create mode'}
          </span>
          {currentArrangement && (
            <span className="text-[10px] text-[var(--text-muted)]">
              Now playing: <strong>{currentArrangement.title}</strong>
            </span>
          )}
        </div>
      </Panel>
    </div>
  );
}

export default LibraryModal;
