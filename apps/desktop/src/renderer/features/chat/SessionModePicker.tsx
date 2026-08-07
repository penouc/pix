import type { SessionMode } from '@pi-desktop/protocol';

import { Segmented } from '@/components/ui/segmented';

/**
 * Plan = read-only toolset (explore / propose). Build = full coding tools.
 * Orthogonal to the approval-mode picker (“Ask / Auto / Read-only”).
 */
export function SessionModePicker({
  mode,
  onChange,
  disabled,
}: {
  mode: SessionMode;
  onChange: (mode: SessionMode) => void;
  disabled?: boolean;
}) {
  return (
    <Segmented
      aria-label="Session mode"
      size="sm"
      options={[
        {
          value: 'plan',
          label: 'Plan',
          disabled,
          title: 'Read-only tools — explore and propose without writing',
        },
        {
          value: 'build',
          label: 'Build',
          disabled,
          title: 'Full coding tools — read, edit, write, bash',
        },
      ]}
      value={mode}
      onChange={(value) => onChange(value as SessionMode)}
    />
  );
}
