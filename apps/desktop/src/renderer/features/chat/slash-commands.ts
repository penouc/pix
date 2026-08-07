/**
 * Composer `/` commands (#6).
 *
 * Pi's own CLI treats a line-start `/word` as a built-in command; the desktop
 * shell mirrors that: when the draft ends in a line-start slash word, the
 * composer offers matching commands (compact, plan/build mode, auto model,
 * clear queue, new task). Selecting one runs it and clears the draft instead
 * of sending the literal slash text to the model.
 */

/** One entry in the composer's `/` menu. */
export interface SlashCommand {
  /** Keyword after `/`, e.g. `compact`. */
  keyword: string;
  /** Header shown in the menu. */
  title: string;
  /** One-line explanation. */
  description: string;
  /** Greyed out (and skipped by Enter) while the command cannot run. */
  disabled?: boolean;
  run: () => void;
}

/**
 * Match a line-start slash word at the end of the draft. Returns the keyword
 * typed so far, or undefined when the draft is not ending in `/word`.
 *
 * Anchored to line starts only (`^` or after `\n`) — a slash in the middle of
 * a sentence is prose, not a command.
 */
export function matchSlashQuery(draft: string): string | undefined {
  const match = /(?:^|\n)\/([a-z-]*)$/i.exec(draft);
  return match?.[1];
}

/** Commands whose keyword starts with the typed prefix, in menu order. */
export function filterSlashCommands(
  commands: SlashCommand[],
  prefix: string | undefined,
): SlashCommand[] {
  if (prefix === undefined) return [];
  const needle = prefix.toLowerCase();
  return commands.filter((command) => command.keyword.startsWith(needle));
}
