import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserRole } from '@lab/shared';
import { useAuthStore } from '../../stores/auth-store';
import { TranslationTestTab } from './TranslationTestTab';
import { TranslationSettingsTab } from './TranslationSettingsTab';

const TABS = ['test', 'settings'] as const;
type TabId = (typeof TABS)[number];

/**
 * Speech Translation — the teacher's window onto the live translation
 * pipeline.
 *
 * Test is where a teacher uploads any audio and hears exactly what
 * students hear, with the measured lag beside it; Settings (ADMIN) is
 * where the enabled languages and the engine's latency knobs live. They
 * are one page because tuning is a loop between them: change a knob,
 * re-run the same clip, compare.
 */
export function TranslationPage() {
  const [params, setParams] = useSearchParams();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === UserRole.ADMIN;

  const requested = params.get('tab');
  let tab: TabId = TABS.find((t) => t === requested) ?? 'test';
  // A teacher following an admin's `?tab=settings` link lands on Test
  // rather than an empty pane.
  if (tab === 'settings' && !isAdmin) tab = 'test';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Speech Translation</h1>
        <p className="text-sm text-muted-foreground">
          Translate your voice into students' own languages as you teach. Test any audio file here first — what you hear on
          this page is what a student hears in class.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(next) => setParams({ tab: next }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="test">Test</TabsTrigger>
          {isAdmin && <TabsTrigger value="settings">Settings</TabsTrigger>}
        </TabsList>

        <TabsContent value="test">
          <TranslationTestTab />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="settings">
            <TranslationSettingsTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
