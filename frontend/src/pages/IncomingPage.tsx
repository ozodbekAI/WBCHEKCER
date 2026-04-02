import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import {
  AlertCircle, AlertTriangle, Eye, MoveUpRight, Zap, Camera, FileText,
  ClipboardCheck, Clock, User as UserIcon, Send, ArrowLeft, Trash2, ChevronDown
} from 'lucide-react';
import type { IssuesGrouped, CardApproval, IssueWithCard, TeamTicket } from '../types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const MEDIA_CODES = new Set(['no_photos', 'few_photos', 'add_more_photos', 'no_video']);
function isMediaIssue(issue: IssueWithCard): boolean {
  const code = String(issue.code || '').toLowerCase();
  const category = String(issue.category || '').toLowerCase();
  const fieldPath = String(issue.field_path || '').toLowerCase();
  return MEDIA_CODES.has(code) || category === 'photos' || category === 'video' || fieldPath.startsWith('photos') || fieldPath.startsWith('videos');
}

function isDedicatedMediaIssue(issue: IssueWithCard): boolean {
  return isMediaIssue(issue) && String(issue.severity || '').toLowerCase() !== 'critical';
}

export default function IncomingPage() {
  const navigate = useNavigate();
  const { activeStore } = useStore();
  const { user } = useAuth();
  const [grouped, setGrouped] = useState<IssuesGrouped | null>(null);
  const [approvals, setApprovals] = useState<CardApproval[]>([]);
  const [tickets, setTickets] = useState<TeamTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvalsExpanded, setApprovalsExpanded] = useState(false);

  useEffect(() => {
    if (activeStore) loadAll();
  }, [activeStore]);

  const loadAll = async () => {
    if (!activeStore) return;
    setLoading(true);
    try {
      const [groupedData, approvalsData, ticketsData] = await Promise.all([
        api.getIssuesGrouped(activeStore.id),
        api.getApprovals(activeStore.id, { status: 'pending', limit: 100 }).catch(() => ({ items: [] })),
        api.getTeamTickets(activeStore.id, { status: 'pending' }).catch(() => []),
      ]);
      setGrouped(groupedData);
      setApprovals(approvalsData.items || []);
      setTickets(ticketsData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDismissTicket = async (e: React.MouseEvent, ticketId: number) => {
    e.stopPropagation();
    if (!activeStore) return;
    try {
      await api.completeTeamTicket(activeStore.id, ticketId);
      setTickets(prev => prev.filter(t => t.id !== ticketId));
    } catch (err) {
      console.error(err);
    }
  };

  if (loading || !grouped) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 text-muted-foreground">
        <div className="w-8 h-8 border-3 border-border border-t-primary rounded-full animate-spin" />
        <span className="text-sm">Загрузка задач...</span>
      </div>
    );
  }

  // Separate media issues from severity groups
  const mediaFromWarnings = grouped.warnings.filter(isDedicatedMediaIssue);
  const mediaFromImprovements = grouped.improvements.filter(isDedicatedMediaIssue);
  const allMediaIssues = [...mediaFromWarnings, ...mediaFromImprovements];
  const mediaCards = new Set(allMediaIssues.map(i => i.card_id)).size;

  const criticalIssues = grouped.critical || [];
  const nonMediaWarnings = grouped.warnings.filter(i => !isDedicatedMediaIssue(i));
  const nonMediaImprovements = grouped.improvements.filter(i => !isDedicatedMediaIssue(i));

  const criticalCards = new Set(criticalIssues.map(i => i.card_id)).size;
  const criticalProblems = new Set(criticalIssues.map(i => i.code)).size;
  const warningCards = new Set(nonMediaWarnings.map(i => i.card_id)).size;
  const warningProblems = new Set(nonMediaWarnings.map(i => i.code)).size;
  const improvementCards = new Set(nonMediaImprovements.map(i => i.card_id)).size;
  const improvementProblems = new Set(nonMediaImprovements.map(i => i.code)).size;

  const delegationTickets = tickets.filter(t => t.type === 'delegation');
  const approvalTickets = tickets.filter(t => t.type === 'approval');
  const approvalTicketIds = new Set(approvalTickets.map(t => t.approval_id).filter(Boolean));
  const reviewApprovals = approvals.filter(
    a => (a.reviewed_by_id === null || a.reviewed_by_id === user?.id) && !approvalTicketIds.has(a.id)
  );
  const hasApprovals = reviewApprovals.length > 0;
  const totalPostponed = grouped.postponed_count;

  const hasAnyContent = criticalIssues.length > 0 || nonMediaWarnings.length > 0 ||
    nonMediaImprovements.length > 0 || totalPostponed > 0 || delegationTickets.length > 0 || allMediaIssues.length > 0 ||
    hasApprovals || approvalTickets.length > 0;

  return (
    <div className="max-w-[1060px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex flex-col mb-4">
        <button
          onClick={() => navigate('/workspace')}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-4 self-start"
        >
          <ArrowLeft size={14} />
          Рабочее пространство
        </button>
        <h1 className="text-2xl font-bold text-foreground">Входящие задачи</h1>
      </div>

      {/* Approvals */}
      {(approvalTickets.length > 0 || hasApprovals) && (
        <SeverityCard
          borderColor="border-l-blue-500"
          onClick={() => setApprovalsExpanded(!approvalsExpanded)}
          clickable
        >
          <div className="flex items-center justify-between w-full">
            <div className="flex-1">
              <h3 className="text-[15px] font-semibold text-foreground">На согласование</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Карточки, ожидающие проверки и утверждения</p>
            </div>
            <div className="flex items-center gap-6 mr-4">
              <StatBlock icon={<ClipboardCheck size={12} />} value={approvalTickets.length + reviewApprovals.length} label="карточек" color="text-blue-500" />
              <StatBlock value={new Set([
                        ...approvalTickets.map(t => t.from_user_name || ''),
                        ...reviewApprovals.map(a => String(a.prepared_by_id))
                      ]).size} label="авторов" />
            </div>
            <ChevronDown
              size={18}
              className={`text-muted-foreground transition-transform duration-200 ${approvalsExpanded ? 'rotate-180' : ''}`}
            />
          </div>

          {approvalsExpanded && (
            <div className="mt-3 flex flex-col gap-2 w-full" onClick={e => e.stopPropagation()}>
              {approvalTickets.map(ticket => (
                <div
                  key={ticket.id}
                  onClick={() => navigate(`/workspace/cards/${ticket.card_id}`)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                >
                  {ticket.card_photo && (
                    <img src={ticket.card_photo} alt="" className="w-9 h-9 rounded-md object-cover flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">{ticket.card_title || `Карточка #${ticket.card_nm_id || ticket.card_id}`}</div>
                    <div className="text-[11px] text-muted-foreground">
                      от {ticket.from_user_name} • {new Date(ticket.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {ticket.note && (
                      <div className="flex items-center gap-1.5 mt-1 px-2 py-1 rounded-md bg-primary/8 border border-primary/15">
                        <FileText size={12} className="text-primary flex-shrink-0" />
                        <span className="text-[11px] text-foreground truncate">{ticket.note}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <Button size="sm" className="text-[11px] h-7 px-2.5">Проверить</Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-1.5"
                      onClick={(e) => void handleDismissTicket(e, ticket.id)}
                      title="Отклонить"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SeverityCard>
      )}

      {/* Media (Фото и видео) */}
      {allMediaIssues.length > 0 && (
        <SeverityCard
          borderColor="border-l-violet-500"
          onClick={() => navigate('/workspace/fix/media')}
          clickable
        >
          <div className="flex items-center justify-between w-full">
            <div className="flex-1">
              <h3 className="text-[15px] font-semibold text-foreground">Фото и видео</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Недостающие или проблемные медиафайлы</p>
            </div>
            <div className="flex items-center gap-6 mr-4">
              <StatBlock icon={<Camera size={12} />} value={allMediaIssues.length} label="ошибок" color="text-violet-500" />
              <StatBlock value={mediaCards} label="карточек" />
            </div>
            <Button size="sm" className="gap-1.5 border border-violet-500/30 bg-violet-500/10 text-violet-600 hover:bg-violet-500/20">
              <Camera size={14} /> Открыть
            </Button>
          </div>
        </SeverityCard>
      )}

      {/* Critical */}
      {criticalIssues.length > 0 && (
        <SeverityCard
          borderColor="border-l-destructive"
          onClick={() => navigate('/workspace/fix/critical')}
          clickable
        >
          <div className="flex items-center justify-between w-full">
            <div className="flex-1">
              <h3 className="text-[15px] font-semibold text-foreground">Критические ошибки</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Блокируют показы или продажи</p>
            </div>
            <div className="flex items-center gap-6 mr-4">
              <StatBlock icon={<Eye size={12} />} value={criticalIssues.length} label="ошибок" color="text-destructive" />
              <StatBlock value={criticalCards} label="карточек" />
              <StatBlock value={criticalProblems} label="проблем" />
            </div>
            <Button size="sm" variant="destructive" className="gap-1.5">
              <Zap size={14} /> Начать исправление
            </Button>
          </div>
        </SeverityCard>
      )}

      {/* Warnings */}
      {nonMediaWarnings.length > 0 && (
        <SeverityCard
          borderColor="border-l-zone-yellow"
          onClick={() => navigate('/workspace/fix/warning')}
          clickable
        >
          <div className="flex items-center justify-between w-full">
            <div className="flex-1">
              <h3 className="text-[15px] font-semibold text-foreground">Предупреждения</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Снижают конверсию</p>
            </div>
            <div className="flex items-center gap-6 mr-4">
              <StatBlock icon={<AlertTriangle size={12} />} value={nonMediaWarnings.length} label="ошибок" color="text-zone-yellow" />
              <StatBlock value={warningCards} label="карточек" />
              <StatBlock value={warningProblems} label="проблем" />
            </div>
            <Button size="sm" className="gap-1.5">
              <Zap size={14} /> Начать исправление
            </Button>
          </div>
        </SeverityCard>
      )}

      {/* Improvements */}
      {nonMediaImprovements.length > 0 && (
        <SeverityCard
          borderColor="border-l-zone-green"
          onClick={() => navigate('/workspace/fix/improvement')}
          clickable
        >
          <div className="flex items-center justify-between w-full">
            <div className="flex-1">
              <h3 className="text-[15px] font-semibold text-foreground">Точки роста</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Возможности улучшения показателей</p>
            </div>
            <div className="flex items-center gap-6 mr-4">
              <StatBlock icon={<MoveUpRight size={12} />} value={nonMediaImprovements.length} label="ошибок" color="text-zone-green" />
              <StatBlock value={improvementCards} label="карточек" />
              <StatBlock value={improvementProblems} label="проблем" />
            </div>
            <Button size="sm" variant="secondary" className="gap-1.5 border border-zone-green/30 bg-zone-green/10 text-zone-green hover:bg-zone-green/20">
              <Zap size={14} /> Начать улучшение
            </Button>
          </div>
        </SeverityCard>
      )}

      {/* Postponed */}
      {(totalPostponed > 0 || delegationTickets.length > 0) && (
        <SeverityCard
          borderColor="border-l-muted-foreground"
          onClick={() => navigate('/workspace/fix/postponed')}
          clickable
        >
          <div className="flex items-center justify-between w-full">
            <div className="flex-1">
              <h3 className="text-[15px] font-semibold text-foreground">Переданные задачи</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Задачи, переданные для обработки позже</p>
            </div>
            <div className="flex items-center gap-6 mr-4">
              <StatBlock icon={<AlertCircle size={12} />} value={totalPostponed} label="задач" />
              {delegationTickets.length > 0 && (
                <StatBlock value={delegationTickets.length} label="передано" />
              )}
            </div>
            <Button size="sm" variant="secondary">Продолжить работу</Button>
          </div>
        </SeverityCard>
      )}

      {/* Empty */}
      {!hasAnyContent && (
        <div className="text-center py-16 text-muted-foreground">
          Нет входящих задач
        </div>
      )}
    </div>
  );
}

/* ── Shared sub-components ── */

function SeverityCard({ children, borderColor, onClick, clickable }: {
  children: React.ReactNode;
  borderColor: string;
  onClick?: () => void;
  clickable?: boolean;
}) {
  return (
    <div
      className={`bg-card border border-border rounded-xl p-5 mb-3 flex flex-wrap items-center transition-all border-l-4 ${borderColor} ${clickable ? 'cursor-pointer hover:shadow-md' : ''}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

function StatBlock({ icon, value, label, color }: {
  icon?: React.ReactNode;
  value: number;
  label: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center min-w-[60px]">
      <div className="flex items-center gap-1.5">
        {icon && <span className={`${color || 'text-muted-foreground'}`}>{icon}</span>}
        <span className={`font-bold text-lg leading-none ${color || 'text-foreground'}`}>{value}</span>
      </div>
      <span className="text-[11px] text-muted-foreground mt-1">{label}</span>
    </div>
  );
}
