import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Maximize, Minimize, X, PanelLeftClose, PanelLeft,
  Search, AlertTriangle, Camera, MessageSquare, Users, Shield,
  TrendingUp, Zap, Clock, FileCheck, Image, Video, Bot, Star,
  ArrowRight, CheckCircle2, Layers, Target, Settings, Activity,
  DollarSign, Rocket, Mail, Phone, Eye, BarChart3
} from 'lucide-react';
import '../styles/presentation.css';

interface SlideData {
  id: number;
  title: string;
  dark: boolean;
  render: () => React.ReactNode;
}

function Slide({ dark, children }: { dark?: boolean; children: React.ReactNode }) {
  return (
    <div className={`slide-content ${dark ? 'slide-dark' : 'slide-light'}`}>
      {children}
    </div>
  );
}

const slides: SlideData[] = [
  /* 1 — Title */
  {
    id: 1, title: 'Титульный', dark: true,
    render: () => (
      <Slide dark>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', textAlign: 'center', padding: '0 180px' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#6C8EFF', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 32 }}>
            WB Optimizer
          </div>
          <h1 style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.1, letterSpacing: -2, marginBottom: 32, margin: 0 }}>
            Операционная система<br />для крупного селлера
          </h1>
          <div className="accent-line" style={{ margin: '32px auto' }} />
          <p style={{ fontSize: 24, color: '#94A3B8', maxWidth: 900, lineHeight: 1.6, margin: 0 }}>
            Автоматизация аудита, фотостудия с ИИ, умные ответы и рекомендации —<br />всё в одном инструменте для магазинов с 500+ карточками
          </p>
        </div>
      </Slide>
    ),
  },

  /* 2 — Scale of problem */
  {
    id: 2, title: 'Масштаб проблемы', dark: true,
    render: () => (
      <Slide dark>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: '80px 120px' }}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>Масштаб проблемы</h2>
          <p className="section-subtitle" style={{ marginBottom: 56 }}>Что происходит в магазине с 500+ карточками без автоматизации</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 28 }}>
            {[
              { num: '500+', label: 'Карточек в среднем магазине', icon: <Layers size={32} /> },
              { num: '73%', label: 'Содержат ошибки в описаниях', icon: <AlertTriangle size={32} /> },
              { num: '120ч', label: 'В месяц на ручной аудит', icon: <Clock size={32} /> },
              { num: '−18%', label: 'Потери выручки из-за ошибок', icon: <TrendingUp size={32} /> },
            ].map((s, i) => (
              <div key={i} className="feature-card" style={{ textAlign: 'center', padding: 28 }}>
                <div className="icon-circle" style={{ margin: '0 auto 16px' }}>{s.icon}</div>
                <div className="stat-number stat-number-accent">{s.num}</div>
                <div className="stat-label" style={{ fontSize: 18 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </Slide>
    ),
  },

  /* 3 — Current pain */
  {
    id: 3, title: 'Как сейчас', dark: false,
    render: () => (
      <Slide>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: '80px 120px' }}>
          <h2 className="section-title" style={{ color: '#1E293B', marginBottom: 12 }}>Как это работает сейчас</h2>
          <p className="section-subtitle" style={{ color: '#64748B', marginBottom: 40 }}>Типичный день менеджера маркетплейса</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {[
              { title: 'Excel-таблицы', desc: 'Ручное ведение ошибок в таблицах. Данные теряются, дублируются, не синхронизируются.' },
              { title: 'Без приоритетов', desc: 'Нет понимания, какие ошибки критичны, а какие можно отложить. Время уходит на мелочи.' },
              { title: 'Нет контроля команды', desc: 'Руководитель не видит, кто что делает. Задачи назначаются устно или в чатах.' },
              { title: 'Ответы вслепую', desc: 'На вопросы отвечают без понимания контекста. Нет анализа тональности, нет шаблонов.' },
            ].map((p, i) => (
              <div key={i} className="pain-card-light" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <AlertTriangle size={26} color="#EF4444" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#1E293B', marginBottom: 6 }}>{p.title}</div>
                  <div style={{ fontSize: 17, color: '#64748B', lineHeight: 1.5 }}>{p.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Slide>
    ),
  },

  /* 4 — Platform overview */
  {
    id: 4, title: 'Платформа', dark: true,
    render: () => (
      <Slide dark>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: '80px 120px' }}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>Как работает WB Optimizer</h2>
          <p className="section-subtitle" style={{ marginBottom: 56 }}>4 шага от хаоса к системе</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 24 }}>
            {[
              { step: 1, title: 'Подключение', desc: 'Подключаете API магазина. Данные загружаются автоматически.', icon: <Zap size={24} /> },
              { step: 2, title: 'Автоанализ', desc: 'ИИ сканирует все карточки. Находит ошибки и группирует по критичности.', icon: <Search size={24} /> },
              { step: 3, title: 'Тикеты', desc: 'Каждая ошибка — тикет. Назначается ответственный, дедлайн, приоритет.', icon: <FileCheck size={24} /> },
              { step: 4, title: 'Контроль', desc: 'Дашборд показывает прогресс. Согласования, аудит действий, метрики.', icon: <Shield size={24} /> },
            ].map((s, i) => (
              <div key={i} className="feature-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: 28 }}>
                <div className="step-dot" style={{ marginBottom: 16 }}>{s.step}</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>{s.title}</div>
                <div style={{ fontSize: 16, color: '#94A3B8', lineHeight: 1.5 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Slide>
    ),
  },

  /* 5 — Card audit */
  {
    id: 5, title: 'Аудит карточек', dark: false,
    render: () => (
      <Slide>
        <div style={{ display: 'flex', width: '100%', height: '100%' }}>
          <div style={{ flex: 1, padding: '80px 48px 80px 120px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="accent-line" style={{ marginBottom: 20 }} />
            <h2 className="section-title" style={{ color: '#1E293B', marginBottom: 12, fontSize: 48 }}>Аудит карточек</h2>
            <p style={{ fontSize: 18, color: '#64748B', lineHeight: 1.6, marginBottom: 36 }}>
              ИИ анализирует каждую карточку по 30+ параметрам и группирует ошибки по уровню критичности
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {[
                { color: '#EF4444', label: 'Критичные', desc: 'Блокируют продажи. Исправляются первыми.' },
                { color: '#EAB308', label: 'Важные', desc: 'Снижают конверсию. Исправить в течение недели.' },
                { color: '#22C55E', label: 'Улучшения', desc: 'Повышают качество. Планируются постепенно.' },
              ].map((z, i) => (
                <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: z.color, flexShrink: 0 }} />
                  <div>
                    <span style={{ fontSize: 18, fontWeight: 700, color: '#1E293B' }}>{z.label}: </span>
                    <span style={{ fontSize: 16, color: '#64748B' }}>{z.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, padding: '80px 120px 80px 48px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20 }}>
            {[
              { icon: <Search size={26} />, title: 'Автоматический скан', desc: 'Синхронизация с WB API и мгновенный анализ всех карточек' },
              { icon: <Layers size={26} />, title: 'Очередь задач', desc: 'Карточки с ошибками выстраиваются в очередь для команды' },
              { icon: <Zap size={26} />, title: 'Автоисправления', desc: 'Типовые ошибки исправляются в один клик с предпросмотром' },
            ].map((f, i) => (
              <div key={i} className="feature-card-light" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: 24 }}>
                <div className="icon-circle icon-circle-light" style={{ width: 52, height: 52 }}>{f.icon}</div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#1E293B', marginBottom: 4 }}>{f.title}</div>
                  <div style={{ fontSize: 16, color: '#64748B', lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Slide>
    ),
  },


  /* 7 — Photo Studio */
  {
    id: 7, title: 'Фотостудия', dark: false,
    render: () => (
      <Slide>
        <div style={{ display: 'flex', width: '100%', height: '100%' }}>
          <div style={{ flex: 1, padding: '80px 48px 80px 120px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="accent-line" style={{ marginBottom: 20 }} />
            <h2 className="section-title" style={{ color: '#1E293B', marginBottom: 12, fontSize: 48 }}>Фотостудия с ИИ</h2>
            <p style={{ fontSize: 18, color: '#64748B', lineHeight: 1.6, marginBottom: 36 }}>
              Генерация и редактирование визуального контента прямо из карточки товара
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {[
                { icon: <Image size={22} />, title: 'Генерация фото', desc: 'Создание изображений по описанию или на основе существующих фото' },
                { icon: <Video size={22} />, title: 'Генерация видео', desc: 'Короткие ролики для карточек за несколько минут' },
                { icon: <Camera size={22} />, title: 'Из карточки', desc: 'Работает как отдельный режим, так и прямо из карточки товара' },
                { icon: <Settings size={22} />, title: 'ИИ-редактор', desc: 'Удаление фона, ретушь, инфографика — без Photoshop' },
              ].map((f, i) => (
                <div key={i} className="feature-card-light" style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: 20 }}>
                  <div className="icon-circle icon-circle-light" style={{ width: 44, height: 44, borderRadius: 10 }}>{f.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', marginBottom: 4 }}>{f.title}</div>
                    <div style={{ fontSize: 15, color: '#64748B', lineHeight: 1.5 }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
            <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #EEF2FF, #E0E7FF)', borderRadius: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
              <Camera size={72} color="#6C8EFF" strokeWidth={1.5} />
              <div style={{ fontSize: 24, fontWeight: 700, color: '#4338CA' }}>AI Photo Studio</div>
              <div style={{ fontSize: 16, color: '#6366F1', display: 'flex', gap: 16 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Image size={16} /> Фото</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Video size={16} /> Видео</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Zap size={16} /> ИИ</span>
              </div>
            </div>
          </div>
        </div>
      </Slide>
    ),
  },

  /* 8 — Smart Q&A */
  {
    id: 8, title: 'Умные ответы', dark: true,
    render: () => (
      <Slide dark>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: '80px 120px' }}>
          <div className="accent-line" style={{ marginBottom: 20 }} />
          <h2 className="section-title" style={{ marginBottom: 12 }}>Умные ответы на вопросы</h2>
          <p className="section-subtitle" style={{ marginBottom: 44 }}>ИИ категоризирует вопросы, анализирует тональность и предлагает оптимальные ответы</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 28 }}>
            {[
              { icon: <Bot size={34} />, title: 'ИИ-категоризация', desc: 'Автоматическая сортировка по темам: доставка, качество, размеры, комплектация' },
              { icon: <MessageSquare size={34} />, title: 'Анализ тональности', desc: 'Определение настроения покупателя для выбора правильного тона ответа' },
              { icon: <Zap size={34} />, title: 'Автоответы', desc: 'Готовые шаблоны и ИИ-генерация ответов с учётом контекста товара' },
            ].map((f, i) => (
              <div key={i} className="feature-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: 28 }}>
                <div className="icon-circle" style={{ marginBottom: 16 }}>{f.icon}</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>{f.title}</div>
                <div style={{ fontSize: 16, color: '#94A3B8', lineHeight: 1.5 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Slide>
    ),
  },


  /* 10 — Recommendations */
  {
    id: 10, title: 'Рекомендации', dark: false,
    render: () => (
      <Slide>
        <div style={{ display: 'flex', width: '100%', height: '100%' }}>
          <div style={{ flex: 1, padding: '80px 48px 80px 120px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="accent-line" style={{ marginBottom: 20 }} />
            <h2 className="section-title" style={{ color: '#1E293B', marginBottom: 12, fontSize: 48 }}>Рекомендации товаров</h2>
            <p style={{ fontSize: 18, color: '#64748B', lineHeight: 1.6, marginBottom: 36 }}>
              Автоматический подбор рекомендаций для кросс-продаж
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {[
                { icon: <Target size={22} />, title: 'Автоподбор', desc: 'Алгоритм подбирает сопутствующие товары для кросс-продаж' },
                { icon: <Settings size={22} />, title: 'Профили', desc: 'Настраиваемые профили автозаполнения для разных категорий' },
                { icon: <Layers size={22} />, title: 'Drag & Drop', desc: 'Удобное управление порядком рекомендаций перетаскиванием' },
              ].map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <div className="icon-circle icon-circle-light" style={{ width: 44, height: 44, borderRadius: 10 }}>{f.icon}</div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', marginBottom: 4 }}>{f.title}</div>
                    <div style={{ fontSize: 16, color: '#64748B', lineHeight: 1.5 }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
            <div style={{ width: '100%', height: '100%', background: '#F8FAFC', borderRadius: 24, border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 14, padding: 28, justifyContent: 'center' }}>
              {[1, 2, 3, 4].map(n => (
                <div key={n} style={{ background: 'white', borderRadius: 12, padding: '14px 18px', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 8, background: `hsl(${220 + n * 20}, 70%, 95%)`, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ height: 10, background: '#E2E8F0', borderRadius: 6, marginBottom: 6, width: `${70 + n * 5}%` }} />
                    <div style={{ height: 7, background: '#F1F5F9', borderRadius: 4, width: '50%' }} />
                  </div>
                  <Star size={18} color="#EAB308" fill="#EAB308" style={{ flexShrink: 0 }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Slide>
    ),
  },

  /* 11 — Team & control */
  {
    id: 11, title: 'Команда', dark: true,
    render: () => (
      <Slide dark>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: '80px 120px' }}>
          <div className="accent-line" style={{ marginBottom: 20 }} />
          <h2 className="section-title" style={{ marginBottom: 12 }}>Команда и контроль</h2>
          <p className="section-subtitle" style={{ marginBottom: 44 }}>Полный контроль над процессами и сотрудниками</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 28 }}>
            {[
              { icon: <Users size={34} />, title: 'Роли и права', desc: 'Гибкая система ролей: админ, менеджер, контент-мейкер. Каждому — свой уровень доступа.' },
              { icon: <Shield size={34} />, title: 'Согласования', desc: 'Двухступенчатое согласование изменений. Ничего не публикуется без проверки.' },
              { icon: <Activity size={34} />, title: 'Аудит действий', desc: 'Полная история действий каждого сотрудника. Кто, что и когда изменил.' },
            ].map((f, i) => (
              <div key={i} className="feature-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: 28 }}>
                <div className="icon-circle" style={{ marginBottom: 16 }}>{f.icon}</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>{f.title}</div>
                <div style={{ fontSize: 16, color: '#94A3B8', lineHeight: 1.5 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Slide>
    ),
  },


  /* 13 — ROI */
  {
    id: 13, title: 'ROI и цифры', dark: true,
    render: () => (
      <Slide dark>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: '80px 120px' }}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>ROI: цифры говорят сами</h2>
          <p className="section-subtitle" style={{ marginBottom: 48 }}>Средние результаты клиентов за первые 3 месяца</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 40 }}>
            {[
              { num: '−80%', label: 'Времени на аудит', sub: 'Было 120ч/мес → стало 24ч/мес' },
              { num: '+35%', label: 'Качество карточек', sub: 'Больше карточек без ошибок' },
              { num: '×3', label: 'Скорость команды', sub: 'Благодаря очереди задач и автоматизации' },
            ].map((r, i) => (
              <div key={i} className="feature-card" style={{ textAlign: 'center', padding: 28 }}>
                <div className="stat-number stat-number-accent" style={{ marginBottom: 10 }}>{r.num}</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>{r.label}</div>
                <div style={{ fontSize: 16, color: '#94A3B8' }}>{r.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 40, background: 'rgba(108, 142, 255, 0.08)', borderRadius: 16, padding: '24px 36px', display: 'flex', alignItems: 'center', gap: 16 }}>
            <DollarSign size={28} color="#6C8EFF" style={{ flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>Окупаемость за 2-4 недели</div>
              <div style={{ fontSize: 16, color: '#94A3B8' }}>За счёт сокращения ошибок и ускорения работы команды платформа окупается в первый месяц</div>
            </div>
          </div>
        </div>
      </Slide>
    ),
  },

  /* 14 — Getting Started / CTA */
  {
    id: 14, title: 'Подключение', dark: true,
    render: () => (
      <Slide dark>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', textAlign: 'center', padding: '80px 160px' }}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>Начните за 15 минут</h2>
          <p className="section-subtitle" style={{ marginBottom: 48 }}>Три простых шага к автоматизации вашего магазина</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 32, marginBottom: 48, width: '100%' }}>
            {[
              { step: 1, title: 'Регистрация', desc: 'Создайте аккаунт и подключите магазин через API' },
              { step: 2, title: 'Автоанализ', desc: 'Система просканирует все карточки за 10 минут' },
              { step: 3, title: 'Работа', desc: 'Распределяйте задачи команде и отслеживайте прогресс' },
            ].map((s, i) => (
              <div key={i} className="feature-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 28 }}>
                <div className="step-dot" style={{ marginBottom: 16 }}>{s.step}</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{s.title}</div>
                <div style={{ fontSize: 16, color: '#94A3B8', lineHeight: 1.5 }}>{s.desc}</div>
              </div>
            ))}
          </div>
          <button className="cta-button">
            <Rocket size={22} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
            Начать бесплатно
          </button>
        </div>
      </Slide>
    ),
  },

  /* 15 — Contacts */
  {
    id: 15, title: 'Контакты', dark: true,
    render: () => (
      <Slide dark>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', textAlign: 'center', padding: '80px 160px' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#6C8EFF', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 28 }}>
            WB Optimizer
          </div>
          <h2 className="section-title" style={{ marginBottom: 44 }}>Давайте обсудим</h2>
          <div style={{ display: 'flex', gap: 40, marginBottom: 48 }}>
            {[
              { icon: <Mail size={26} />, label: 'viktoriya_bezko@mail.ru' },
              { icon: <Phone size={26} />, label: '+7 (915) 173-39-39' },
            ].map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="icon-circle">{c.icon}</div>
                <span style={{ fontSize: 18, color: '#CBD5E1' }}>{c.label}</span>
              </div>
            ))}
          </div>
          <div className="accent-line" style={{ margin: '0 auto 28px' }} />
          <p style={{ fontSize: 18, color: '#64748B' }}>Спасибо за внимание</p>
        </div>
      </Slide>
    ),
  },
];

/* ───────── Thumbnail ───────── */
function Thumbnail({ slide, index, active, onClick, containerWidth }: {
  slide: SlideData; index: number; active: boolean; onClick: () => void; containerWidth: number;
}) {
  const scale = Math.max((containerWidth - 16) / 1920, 0.05);
  return (
    <div className={`pres-thumb ${active ? 'active' : ''}`} onClick={onClick}>
      <div style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
        {slide.render()}
      </div>
      <div className="pres-thumb-num">{index + 1}</div>
    </div>
  );
}

/* ───────── Main ───────── */
export default function PresentationPage() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const updateScale = useCallback(() => {
    if (!viewportRef.current) return;
    const { clientWidth: w, clientHeight: h } = viewportRef.current;
    setScale(Math.min(w / 1920, h / 1080));
  }, []);

  useEffect(() => {
    updateScale();
    const obs = new ResizeObserver(updateScale);
    if (viewportRef.current) obs.observe(viewportRef.current);
    return () => obs.disconnect();
  }, [updateScale, sidebarOpen]);

  const next = useCallback(() => setCurrent(c => Math.min(c + 1, slides.length - 1)), []);
  const prev = useCallback(() => setCurrent(c => Math.max(c - 1, 0)), []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      if (e.key === 'Escape') {
        if (isFullscreen) { document.exitFullscreen?.(); }
        else navigate(-1);
      }
      if (e.key === 'F5') { e.preventDefault(); toggleFullscreen(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [next, prev, isFullscreen, navigate, toggleFullscreen]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  return (
    <div className={`pres-root ${isFullscreen ? 'fullscreen' : ''}`}>
      {!isFullscreen && (
        <button className="pres-close" onClick={() => navigate(-1)} title="Закрыть">
          <X size={18} />
        </button>
      )}

      <div className={`pres-sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        {slides.map((s, i) => (
          <Thumbnail key={s.id} slide={s} index={i} active={i === current} onClick={() => setCurrent(i)} containerWidth={204} />
        ))}
      </div>

      <div className="pres-canvas">
        <div className="pres-viewport" ref={viewportRef}>
          <div className="pres-slide-wrapper" style={{ transform: `scale(${scale})` }}>
            {slides[current].render()}
          </div>
        </div>

        {!isFullscreen && (
          <div className="pres-bottombar">
            <button onClick={() => setSidebarOpen(o => !o)} title="Панель слайдов">
              {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
            </button>
            <button onClick={prev} disabled={current === 0}><ChevronLeft size={18} /></button>
            <span className="pres-counter">{current + 1} / {slides.length}</span>
            <button onClick={next} disabled={current === slides.length - 1}><ChevronRight size={18} /></button>
            <button onClick={toggleFullscreen} title="Полный экран">
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
