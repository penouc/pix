import type { SavedMemory } from '@pi-desktop/protocol';

/** ChatGPT-style user-scoped saved memories (cross-project). */
export interface UserMemoryRepository {
  list(): SavedMemory[];
  get(id: string): SavedMemory | undefined;
  add(input: { content: string; source?: SavedMemory['source'] }): SavedMemory;
  update(id: string, content: string): SavedMemory | undefined;
  delete(id: string): boolean;
  clear(): number;
}
