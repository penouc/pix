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
