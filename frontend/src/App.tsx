import React, { Suspense, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { StoreProvider, useStore } from './contexts/StoreContext';
import { initWorkTrackerListeners } from './hooks/useWorkTracker';
import SyncProgressBanner from './components/SyncProgressBanner';
import StoreFeatureBlockedState from './components/StoreFeatureBlockedState';
import AdAnalysisBootstrapGate from './components/AdAnalysisBootstrapGate';
import { isStoreFeatureAllowed, type StoreFeatureKey } from './lib/storeAccess';
import { Toaster } from 'sonner';

const LandingPage = React.lazy(() => import('./pages/LandingPage'));
const LoginPage = React.lazy(() => import('./pages/LoginPage'));
const RegisterPage = React.lazy(() => import('./pages/RegisterPage'));
const VerifyEmailPage = React.lazy(() => import('./pages/VerifyEmailPage'));
const OnboardingPage = React.lazy(() => import('./pages/OnboardingPage'));
const WorkspacePage = React.lazy(() => import('./pages/WorkspacePage'));
const IncomingPage = React.lazy(() => import('./pages/IncomingPage'));
const IssueFixPage = React.lazy(() => import('./pages/IssueFixPage'));
const CardListPage = React.lazy(() => import('./pages/CardListPage'));
const CardDetailPage = React.lazy(() => import('./pages/CardDetailPage'));
const CardQueuePage = React.lazy(() => import('./pages/CardQueuePage'));
const PhotoStudioPage = React.lazy(() => import('./pages/PhotoStudioPage'));
const ABTestsPage = React.lazy(() => import('./pages/ABTestsPage'));
const TeamPage = React.lazy(() => import('./pages/TeamPage'));
const ApprovalsPage = React.lazy(() => import('./pages/ApprovalsPage'));
const StaffPage = React.lazy(() => import('./pages/StaffPage'));
const AcceptInvitePage = React.lazy(() => import('./pages/AcceptInvitePage'));
const FixedFilePage = React.lazy(() => import('./pages/FixedFilePage'));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage'));
const PresentationPage = React.lazy(() => import('./pages/PresentationPage'));
const PresentationFullPage = React.lazy(() => import('./pages/PresentationFullPage'));
const ManagementPage = React.lazy(() => import('./pages/ManagementPage'));
const AdAnalysisPage = React.lazy(() => import('./pages/AdAnalysisPage'));
const NotFoundPage = React.lazy(() => import('./pages/NotFound'));

function GlobalSyncBanner() {
  const { activeStore, loadStores } = useStore();
  if (!activeStore) return null;
  const handleComplete = useCallback(() => {
    loadStores();
    window.dispatchEvent(new CustomEvent('syncCompleted', { detail: { storeId: activeStore.id } }));
  }, [loadStores, activeStore.id]);
  return <SyncProgressBanner storeId={activeStore.id} onComplete={handleComplete} />;
}

function ProtectedRoute({
  children,
  permission,
  storeFeature,
}: {
  children: React.ReactNode;
  permission?: string;
  storeFeature?: StoreFeatureKey;
}) {
  const { isAuthenticated, loading, hasPermission } = useAuth();
  const { storesReady, activeStore, stores } = useStore();
  if (loading) return <div className="loading-page"><div className="loading-center"><div className="spinner" /></div></div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!storesReady) return <div className="loading-page"><div className="loading-center"><div className="spinner" /></div></div>;
  if (permission && !hasPermission(permission)) return <Navigate to="/workspace" replace />;
  if (storeFeature) {
    if (!activeStore && stores.length > 0) return <div className="loading-page"><div className="loading-center"><div className="spinner" /></div></div>;
    if (!activeStore) return <Navigate to="/workspace" replace />;
    if (!isStoreFeatureAllowed(activeStore, storeFeature)) {
      return <StoreFeatureBlockedState featureKey={storeFeature} />;
    }
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <>
      <Suspense fallback={<div className="loading-page"><div className="loading-center"><div className="spinner" /></div></div>}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="/presentation" element={<PresentationPage />} />
          <Route path="/presentation-full" element={<PresentationFullPage />} />
          <Route path="/onboard" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
          <Route path="/workspace" element={<ProtectedRoute><WorkspacePage /></ProtectedRoute>} />
          <Route path="/workspace/incoming" element={<ProtectedRoute storeFeature="cards"><IncomingPage /></ProtectedRoute>} />
          <Route path="/workspace/fix/:severity" element={<ProtectedRoute storeFeature="cards"><IssueFixPage /></ProtectedRoute>} />
          <Route path="/workspace/fix/card/:cardId" element={<ProtectedRoute storeFeature="cards"><IssueFixPage /></ProtectedRoute>} />
          <Route path="/workspace/cards" element={<ProtectedRoute storeFeature="cards"><CardListPage /></ProtectedRoute>} />
          <Route path="/workspace/cards/queue" element={<ProtectedRoute storeFeature="cards"><CardQueuePage /></ProtectedRoute>} />
          <Route path="/workspace/cards/:cardId" element={<ProtectedRoute storeFeature="cards"><CardDetailPage /></ProtectedRoute>} />
          <Route path="/photo-studio" element={<ProtectedRoute permission="photos.manage" storeFeature="photo_studio"><PhotoStudioPage /></ProtectedRoute>} />
          <Route path="/ab-tests" element={<ProtectedRoute storeFeature="ab_tests"><ABTestsPage /></ProtectedRoute>} />
          <Route path="/workspace/team" element={<ProtectedRoute permission="team.view"><TeamPage /></ProtectedRoute>} />
          <Route path="/workspace/approvals" element={<ProtectedRoute><ApprovalsPage /></ProtectedRoute>} />
          <Route path="/workspace/staff" element={<ProtectedRoute permission="team.view"><StaffPage /></ProtectedRoute>} />
          <Route path="/management" element={<ProtectedRoute permission="team.view"><ManagementPage /></ProtectedRoute>} />
          <Route
            path="/workspace/ad-analysis"
            element={
              <ProtectedRoute storeFeature="ad_analysis">
                <AdAnalysisBootstrapGate>
                  <AdAnalysisPage />
                </AdAnalysisBootstrapGate>
              </ProtectedRoute>
            }
          />
          <Route path="/workspace/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/workspace/fixed-file" element={<ProtectedRoute><FixedFilePage /></ProtectedRoute>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      <GlobalSyncBanner />
      <Toaster richColors position="top-right" />
    </>
  );
}

export default function App() {
  useEffect(() => {
    const cleanup = initWorkTrackerListeners();
    return cleanup;
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <StoreProvider>
          <AppRoutes />
        </StoreProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
