import { z } from 'zod';

/** ChatGPT-style saved memories — durable facts about the user across projects. */
export const SavedMemorySchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1).max(2000),
  /** Who wrote it: the user in Settings, or the agent via the memory tool. */
  source: z.enum(['user', 'agent']).default('user'),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type SavedMemory = z.infer<typeof SavedMemorySchema>;

export const ListMemoriesInputSchema = z.object({}).optional();
export type ListMemoriesInput = z.infer<typeof ListMemoriesInputSchema>;

export const AddMemoryInputSchema = z.object({
  content: z.string().min(1).max(2000),
  source: z.enum(['user', 'agent']).optional(),
});
export type AddMemoryInput = z.infer<typeof AddMemoryInputSchema>;

export const UpdateMemoryInputSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1).max(2000),
});
export type UpdateMemoryInput = z.infer<typeof UpdateMemoryInputSchema>;

export const DeleteMemoryInputSchema = z.object({
  id: z.string().min(1),
});
export type DeleteMemoryInput = z.infer<typeof DeleteMemoryInputSchema>;

export const ClearMemoriesInputSchema = z.object({}).optional();
export type ClearMemoriesInput = z.infer<typeof ClearMemoriesInputSchema>;

/** One note in a project's `.pi-desktop/agent/memory.json` scratchpad. */
export const ProjectMemoryNoteSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  updatedAt: z.number().int().nonnegative(),
});
export type ProjectMemoryNote = z.infer<typeof ProjectMemoryNoteSchema>;

export const ProjectMemoryGroupSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  projectPath: z.string().min(1),
  notes: z.array(ProjectMemoryNoteSchema),
});
export type ProjectMemoryGroup = z.infer<typeof ProjectMemoryGroupSchema>;

export const ListProjectMemoriesInputSchema = z
  .object({
    /** When omitted, returns notes from all recently opened projects that have any. */
    projectId: z.string().min(1).optional(),
  })
  .optional();
export type ListProjectMemoriesInput = z.infer<typeof ListProjectMemoriesInputSchema>;

export const DeleteProjectMemoryInputSchema = z.object({
  projectId: z.string().min(1),
  key: z.string().min(1),
});
export type DeleteProjectMemoryInput = z.infer<typeof DeleteProjectMemoryInputSchema>;
