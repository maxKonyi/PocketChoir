/* ============================================================
   LIBRARY SERVICE

   Manages the user's personal library of arrangements using
   IndexedDB (via the `idb` package). Supports:
   - Saving / loading / deleting arrangements
   - Folder creation, renaming, deletion
   - Moving items between folders
   - Toggling favorites
   - Search across all saved arrangements
   ============================================================ */

import { openDB, type IDBPDatabase } from 'idb';
import type { LibraryFolder, LibraryItem } from '../types/library';
import type { Arrangement } from '../types';

/* ------------------------------------------------------------
   Database Schema
   ------------------------------------------------------------ */

// Database name and version — bump version to trigger upgrades.
const DB_NAME = 'harmony-singing-library';
const DB_VERSION = 1;

// Object store names inside the database.
const ITEMS_STORE = 'items';    // Stores LibraryItem objects
const FOLDERS_STORE = 'folders'; // Stores LibraryFolder objects

/* ------------------------------------------------------------
   Helper: Open (or create) the database
   ------------------------------------------------------------ */

/**
 * Open the IndexedDB database, creating object stores on first run
 * or when the version number increases.
 */
async function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // ── Items store ──
      // keyPath = 'id' means each LibraryItem is keyed by its `id` field.
      if (!db.objectStoreNames.contains(ITEMS_STORE)) {
        const itemStore = db.createObjectStore(ITEMS_STORE, { keyPath: 'id' });
        // Index by folder so we can quickly list items in a folder.
        itemStore.createIndex('byFolder', 'folderId');
        // Index by favorite flag for quick starred-items queries.
        itemStore.createIndex('byFavorite', 'isFavorite');
      }

      // ── Folders store ──
      if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
        const folderStore = db.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
        // Index by parent so we can list sub-folders.
        folderStore.createIndex('byParent', 'parentId');
      }
    },
  });
}

/* ------------------------------------------------------------
   Generate unique IDs
   ------------------------------------------------------------ */

/**
 * Create a short unique ID using timestamp + random suffix.
 * Example output: "lib_1707234567890_a3f"
 */
function generateId(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 5);
  return `${prefix}_${timestamp}_${random}`;
}

/* ------------------------------------------------------------
   Folder Operations
   ------------------------------------------------------------ */

/**
 * Get all folders in the library.
 */
async function getAllFolders(): Promise<LibraryFolder[]> {
  const db = await getDb();
  return db.getAll(FOLDERS_STORE);
}

/**
 * Create a new folder.
 * @param name - Display name for the folder
 * @param parentId - Parent folder ID, or null for root level
 * @param color - Optional accent color
 * @returns The newly created folder
 */
async function createFolder(
  name: string,
  parentId: string | null = null,
  color?: string,
): Promise<LibraryFolder> {
  const db = await getDb();
  const folder: LibraryFolder = {
    id: generateId('folder'),
    name,
    parentId,
    createdAt: new Date().toISOString(),
    color,
  };
  await db.put(FOLDERS_STORE, folder);
  return folder;
}

/**
 * Rename an existing folder.
 */
async function renameFolder(folderId: string, newName: string): Promise<void> {
  const db = await getDb();
  const folder = await db.get(FOLDERS_STORE, folderId);
  if (!folder) return;
  folder.name = newName;
  await db.put(FOLDERS_STORE, folder);
}

/**
 * Delete a folder and move its contents to the root level.
 * (We don't recursively delete items — we orphan them to root.)
 */
async function deleteFolder(folderId: string): Promise<void> {
  const db = await getDb();

  // Move all items in this folder to root (folderId = null).
  const tx = db.transaction([ITEMS_STORE, FOLDERS_STORE], 'readwrite');
  const itemStore = tx.objectStore(ITEMS_STORE);
  const folderIndex = itemStore.index('byFolder');
  let cursor = await folderIndex.openCursor(IDBKeyRange.only(folderId));
  while (cursor) {
    const item = cursor.value as LibraryItem;
    item.folderId = null;
    await cursor.update(item);
    cursor = await cursor.continue();
  }

  // Move sub-folders to root too.
  const folderStore = tx.objectStore(FOLDERS_STORE);
  const parentIndex = folderStore.index('byParent');
  let subCursor = await parentIndex.openCursor(IDBKeyRange.only(folderId));
  while (subCursor) {
    const sub = subCursor.value as LibraryFolder;
    sub.parentId = null;
    await subCursor.update(sub);
    subCursor = await subCursor.continue();
  }

  // Finally, delete the folder itself.
  await folderStore.delete(folderId);
  await tx.done;
}

/* ------------------------------------------------------------
   Item (Arrangement) Operations
   ------------------------------------------------------------ */

/**
 * Get all library items (arrangements).
 */
async function getAllItems(): Promise<LibraryItem[]> {
  const db = await getDb();
  return db.getAll(ITEMS_STORE);
}

/**
 * Get a single library item by ID.
 */
async function getItem(itemId: string): Promise<LibraryItem | undefined> {
  const db = await getDb();
  return db.get(ITEMS_STORE, itemId);
}

/**
 * Save an arrangement to the user's library.
 * @param arrangement - The arrangement data to save
 * @param folderId - Which folder to put it in (null = root)
 * @param source - 'user' for self-created, 'downloaded' for community
 * @returns The newly created LibraryItem
 */
async function saveArrangement(
  arrangement: Arrangement,
  folderId: string | null = null,
  source: 'user' | 'downloaded' = 'user',
): Promise<LibraryItem> {
  const db = await getDb();
  const now = new Date().toISOString();
  const item: LibraryItem = {
    id: generateId('item'),
    arrangement: { ...arrangement },
    folderId,
    isFavorite: false,
    savedAt: now,
    updatedAt: now,
    source,
  };
  await db.put(ITEMS_STORE, item);
  return item;
}

/**
 * Update an existing library item's arrangement data.
 * Used when re-saving after editing in Create mode.
 */
async function updateArrangement(
  itemId: string,
  arrangement: Arrangement,
): Promise<void> {
  const db = await getDb();
  const item = await db.get(ITEMS_STORE, itemId);
  if (!item) return;
  item.arrangement = { ...arrangement };
  item.updatedAt = new Date().toISOString();
  await db.put(ITEMS_STORE, item);
}

/**
 * Delete a library item permanently.
 */
async function deleteItem(itemId: string): Promise<void> {
  const db = await getDb();
  await db.delete(ITEMS_STORE, itemId);
}

/**
 * Move a library item to a different folder.
 */
async function moveItem(itemId: string, newFolderId: string | null): Promise<void> {
  const db = await getDb();
  const item = await db.get(ITEMS_STORE, itemId);
  if (!item) return;
  item.folderId = newFolderId;
  item.updatedAt = new Date().toISOString();
  await db.put(ITEMS_STORE, item);
}

/**
 * Toggle the favorite status of a library item.
 * @returns The new favorite state (true/false)
 */
async function toggleFavorite(itemId: string): Promise<boolean> {
  const db = await getDb();
  const item = await db.get(ITEMS_STORE, itemId);
  if (!item) return false;
  item.isFavorite = !item.isFavorite;
  await db.put(ITEMS_STORE, item);
  return item.isFavorite;
}

/**
 * Search library items by arrangement title.
 * Returns items whose title contains the query (case-insensitive).
 */
async function searchItems(query: string): Promise<LibraryItem[]> {
  const all = await getAllItems();
  if (!query.trim()) return all;
  const lower = query.toLowerCase();
  return all.filter((item) =>
    item.arrangement.title.toLowerCase().includes(lower)
    || (item.arrangement.description ?? '').toLowerCase().includes(lower)
    || (item.arrangement.tags ?? []).some((tag) => tag.toLowerCase().includes(lower))
  );
}

/* ------------------------------------------------------------
   Public API
   ------------------------------------------------------------ */

export const LibraryService = {
  // Folders
  getAllFolders,
  createFolder,
  renameFolder,
  deleteFolder,

  // Items
  getAllItems,
  getItem,
  saveArrangement,
  updateArrangement,
  deleteItem,
  moveItem,
  toggleFavorite,
  searchItems,
};
