import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";

// Public pages
import Index from "./pages/Index";
import LoginPage from "./pages/login";
import RegisterPage from "./pages/register";
import StartPage from "./pages/start";
import InvitePage from "./pages/invite";
import ResetPasswordPage from "./pages/reset-password";
import NotFound from "./pages/NotFound";

// App (store) pages
import AppShell from "@/components/app-shell";
import DashboardPage from "./pages/app/dashboard";
import FeedbacksPage from "./pages/app/feedbacks";
import QuestionsPage from "./pages/app/questions";
import ChatPage from "./pages/app/chat";
import ChatDetailPage from "./pages/app/chat-detail";
import AnalyticsPage from "./pages/app/analytics";
import SettingsPage from "./pages/app/settings";
import TeamPage from "./pages/app/team";
import BillingPage from "./pages/app/billing";
import DraftsPage from "./pages/app/drafts";
import OnboardingPage from "./pages/app/onboarding";

// Admin pages
import AdminShell from "@/components/admin-shell";
import AdminDashboardPage from "./pages/admin/dashboard";
import AdminUsersPage from "./pages/admin/users";
import AdminShopsPage from "./pages/admin/shops";
import AdminPromptsPage from "./pages/admin/prompts";
import AdminAiPage from "./pages/admin/ai";
import AdminOpsPage from "./pages/admin/ops";
import AdminPaymentsPage from "./pages/admin/payments";
import AdminLogsPage from "./pages/admin/logs";
import AdminAuditPage from "./pages/admin/audit";
import AdminGenerationLogsPage from "./pages/admin/generation-logs";

const queryClient = new QueryClient();

function AppLayout() {
  return (
    <AppShell>
      <Routes>
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="feedbacks" element={<FeedbacksPage />} />
        <Route path="questions" element={<QuestionsPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="chat/:chat_id" element={<ChatDetailPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="drafts" element={<DraftsPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </AppShell>
  );
}

function AdminLayout() {
  return (
    <AdminShell>
      <Routes>
        <Route path="dashboard" element={<AdminDashboardPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="shops" element={<AdminShopsPage />} />
        <Route path="prompts" element={<AdminPromptsPage />} />
        <Route path="ai" element={<AdminAiPage />} />
        <Route path="ops" element={<AdminOpsPage />} />
        <Route path="payments" element={<AdminPaymentsPage />} />
        <Route path="logs" element={<AdminLogsPage />} />
        <Route path="audit" element={<AdminAuditPage />} />
        <Route path="generation-logs" element={<AdminGenerationLogsPage />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </AdminShell>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="light">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/start" element={<StartPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
            <Route path="/app/*" element={<AppLayout />} />
            <Route path="/admin/*" element={<AdminLayout />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
