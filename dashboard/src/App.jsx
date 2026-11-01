import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import NavBar from './components/NavBar';
import Overview from './pages/Overview';
import { useI18n } from './i18n/I18nProvider';

const PipelineDemo = lazy(() => import('./pages/PipelineDemo'));
const ViewMorePage = lazy(() => import('./pages/ViewMorePage'));
const Vergelijken = lazy(() => import('./pages/Vergelijken'));

function PageFallback() {
  const { t } = useI18n();
  return <main className="max-w-[1280px] mx-auto px-4 py-6 md:px-8">{t('common.loading')}</main>;
}

function App() {
  return (
    <Router>
      <NavBar />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/pipeline-demo" element={<PipelineDemo />} />
          <Route path="/thema/:id" element={<ViewMorePage />} />
          <Route path="/thema/:id/subtheme/:subthemeName" element={<ViewMorePage />} />
          <Route path="/vergelijken" element={<Vergelijken />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
