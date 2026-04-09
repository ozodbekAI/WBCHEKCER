import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Clock, Shield, ArrowLeft } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { StaffContent } from './StaffPage';
import TeamTimeTracking from '../components/TeamTimeTracking';
import { TeamContent } from './TeamPage';

export default function ManagementPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="h-14 flex items-center gap-3 px-6 bg-card border-b border-border sticky top-0 z-50">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate('/workspace')}>
          <ArrowLeft size={18} />
        </Button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Users size={18} />
          </div>
          <h1 className="text-lg font-bold text-foreground">Управление</h1>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 py-6">
        <Tabs defaultValue="monitoring" className="w-full">
          <TabsList className="w-full grid grid-cols-3 mb-6">
            <TabsTrigger value="monitoring" className="gap-2">
              <Users size={15} />
              Мониторинг
            </TabsTrigger>
            <TabsTrigger value="time-tracking" className="gap-2">
              <Clock size={15} />
              Учёт времени
            </TabsTrigger>
            <TabsTrigger value="roles" className="gap-2">
              <Shield size={15} />
              Роли и доступ
            </TabsTrigger>
          </TabsList>

          <TabsContent value="monitoring">
            <StaffContent />
          </TabsContent>

          <TabsContent value="time-tracking">
            <TeamTimeTracking />
          </TabsContent>

          <TabsContent value="roles">
            <TeamContent />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
