import { TabBar } from '@/components/tab-bar';
import { getContext } from '@/lib/household';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await getContext(); // sends users without a household to setup
  return (
    <>
      {children}
      <TabBar />
    </>
  );
}
