import { AppShell } from '@/components/layout/AppShell';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { ProjectSidebar } from '@/features/projects/ProjectSidebar';
import { StatusPanel } from '@/features/status/StatusPanel';

export function App() {
  return <AppShell sidebar={<ProjectSidebar />} main={<ChatPanel />} right={<StatusPanel />} />;
}
