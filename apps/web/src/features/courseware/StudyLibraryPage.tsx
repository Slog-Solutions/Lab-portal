import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
// import { StudyModulesTab } from './StudyModulesTab'; // only used by the commented-out Study Modules tab below
import { MediaFilesTab } from '../media/MediaFilesTab';
// import { ContentPackagesTab } from '../media/ContentPackagesTab'; // only used by the commented-out Content Packages tab below

// 'modules' and 'packages' stay out of this list while their tabs are commented
// out, so a stale `?tab=modules` / `?tab=packages` link falls back to Files
// instead of an empty pane.
const TABS = [/* 'modules', */ 'files' /* , 'packages' */] as const;
type TabId = (typeof TABS)[number];

/**
 * One library for teachers (formerly two pages: Media Library and Study
 * Library). Files uploaded on the Files tab are the same MediaAssets a study
 * module attaches — a file can be switched on for every student's Study
 * Material there, or picked into a module — so the two no longer need separate
 * uploads. The tab lives in `?tab=` so the legacy `/media` route can redirect
 * straight to Files and a refresh keeps you where you were.
 */
export function StudyLibraryPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: TabId = TABS.find((t) => t === requested) ?? 'files';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Study Library</h1>
        <p className="text-sm text-muted-foreground">
          Everything students can study from: exercise modules, and the files you share with them — worksheets, texts, audio, video and images.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(next) => setParams({ tab: next }, { replace: true })}>
        <TabsList>
          {/* <TabsTrigger value="modules">Study Modules</TabsTrigger> */}
          <TabsTrigger value="files">Files</TabsTrigger>
          {/* <TabsTrigger value="packages">Content Packages (SCORM/xAPI/HTML)</TabsTrigger> */}
        </TabsList>

        {/* <TabsContent value="modules" className="space-y-4">
          <StudyModulesTab />
        </TabsContent> */}
        <TabsContent value="files">
          <MediaFilesTab />
        </TabsContent>
        {/* <TabsContent value="packages">
          <ContentPackagesTab />
        </TabsContent> */}
      </Tabs>
    </div>
  );
}
