import { describe, expect, it } from 'vitest';

import { filterSlashCommands, matchSlashQuery, type SlashCommand } from './slash-commands';

const commands: SlashCommand[] = [
  { keyword: 'compact', title: 'Compact', description: '', run: () => {} },
  { keyword: 'plan', title: 'Plan mode', description: '', run: () => {} },
  { keyword: 'build', title: 'Build mode', description: '', run: () => {} },
];

describe('matchSlashQuery', () => {
  it('matches a slash word at the start of the draft', () => {
    expect(matchSlashQuery('/comp')).toBe('comp');
    expect(matchSlashQuery('/compact')).toBe('compact');
  });

  it('matches a slash word after a newline', () => {
    expect(matchSlashQuery('explain the diff\n/plan')).toBe('plan');
  });

  it('returns undefined when the draft does not end in a slash word', () => {
    expect(matchSlashQuery('')).toBeUndefined();
    expect(matchSlashQuery('plain text')).toBeUndefined();
    expect(matchSlashQuery('/compact and more')).toBeUndefined();
    // Mid-sentence slash is prose, not a command.
    expect(matchSlashQuery('see /plan for details')).toBeUndefined();
  });
});

describe('filterSlashCommands', () => {
  it('offers commands whose keyword starts with the typed prefix', () => {
    expect(filterSlashCommands(commands, 'pl').map((c) => c.keyword)).toEqual(['plan']);
    expect(filterSlashCommands(commands, 'b').map((c) => c.keyword)).toEqual(['build']);
  });

  it('is case-insensitive', () => {
    expect(filterSlashCommands(commands, 'CO').map((c) => c.keyword)).toEqual(['compact']);
  });

  it('returns nothing with an undefined prefix, all with a bare slash', () => {
    expect(filterSlashCommands(commands, undefined)).toEqual([]);
    // `matchSlashQuery('/')` returns '' — a bare slash means “show every command”.
    expect(filterSlashCommands(commands, '')).toHaveLength(commands.length);
  });
});
