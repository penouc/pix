import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { CheckpointRecoverySummary } from '@pi-desktop/protocol';

import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { DiffPanel } from '@/features/diff/DiffPanel';
import { ProjectSidebar } from '@/features/projects/ProjectSidebar';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { StatusPanel } from '@/features/status/StatusPanel';
import { invoke } from '@/lib/ipc';

export function App() {
  const [view, setView] = useState<'chat' | 'review' | 'settings'>('chat');
  const [recoveryRunId, setRecoveryRunId] = useState<string | undefined>();
  const recoverable = useQuery({
    queryKey: ['checkpoint.listRecoverable'],
    queryFn: () => invoke<CheckpointRecoverySummary[]>({ method: 'checkpoint.listRecoverable' }),
  });

  function reviewRecovery(runId: string) {
    setRecoveryRunId(runId);
    setView('review');
  }

  return (
    <AppShell
      sidebar={<ProjectSidebar />}
      main={
        <div className="flex h-full min-h-0 flex-col">
          <nav className="flex gap-1 border-b border-border px-4 py-2">
            <Button
              size="sm"
              variant={view === 'chat' ? 'default' : 'ghost'}
              onClick={() => setView('chat')}
            >
              Chat
            </Button>
            <Button
              size="sm"
              variant={view === 'review' ? 'default' : 'ghost'}
              onClick={() => {
                setRecoveryRunId(undefined);
                setView('review');
              }}
            >
              Review
            </Button>
            {recoverable.data?.map((checkpoint) => (
              <Button
                key={checkpoint.runId}
                size="sm"
                variant={view === 'review' && recoveryRunId === checkpoint.runId ? 'default' : 'ghost'}
                onClick={() => reviewRecovery(checkpoint.runId!)}
              >
                Recover {checkpoint.workspacePath}
              </Button>
            ))}
            <Button
              size="sm"
              variant={view === 'settings' ? 'default' : 'ghost'}
              onClick={() => setView('settings')}
            >
              Settings
            </Button>
          </nav>
          <div className="min-h-0 flex-1">
            {view === 'chat' ? (
              <ChatPanel />
            ) : view === 'review' ? (
              <DiffPanel
                onContinue={() => setView('chat')}
                recoveryRunId={recoveryRunId}
                onRecoveryResolved={() => {
                  setRecoveryRunId(undefined);
                  void recoverable.refetch();
                }}
              />
            ) : (
              <SettingsPanel />
            )}
          </div>
        </div>
      }
      right={<StatusPanel />}
    />
  );
}
