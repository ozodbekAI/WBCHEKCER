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
  render: (mobile: boolean) => React.ReactNode;
}

function Slide({ dark, children, mobile }: { dark?: boolean; children: React.ReactNode; mobile?: boolean }) {
  return (
    <div className={`slide-content ${dark ? 'slide-dark' : 'slide-light'} ${mobile ? 'slide-mobile' : ''}`}>
      {children}
    </div>
  );
}

/* ─── Helper sizes ─── */
const m = (mobile: boolean, desk: number, mob: number) => mobile ? mob : desk;

const slides: SlideData[] = [
  /* 1 — Title */
  {
    id: 1, title: 'Титульный', dark: true,
    render: (mobile) => (
      <Slide dark mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', textAlign: 'center', padding: mobile ? '32px 24px' : '0 180px' }}>
          <div style={{ fontSize: m(mobile, 18, 13), fontWeight: 600, color: '#6C8EFF', letterSpacing: mobile ? 2 : 4, textTransform: 'uppercase', marginBottom: m(mobile, 32, 12) }}>
            WB Optimizer
          </div>
          <h1 style={{ fontSize: m(mobile, 68, 32), fontWeight: 800, lineHeight: 1.15, letterSpacing: -1, marginBottom: 0, margin: 0 }}>
            Операционная система{mobile ? ' ' : <br />}для крупного селлера
          </h1>
          <div className="accent-line" style={{ margin: `${m(mobile, 32, 14)}px auto`, width: m(mobile, 80, 48), height: m(mobile, 4, 3) }} />
          <p style={{ fontSize: m(mobile, 24, 15), color: '#94A3B8', maxWidth: 900, lineHeight: 1.5, margin: 0 }}>
            Автоматизация аудита, фотостудия с ИИ, умные ответы и рекомендации — всё в одном инструменте для магазинов с 500+ карточками
          </p>
        </div>
      </Slide>
    ),
  },

  /* 2 — Scale of problem */
  {
    id: 2, title: 'Масштаб проблемы', dark: true,
    render: (mobile) => (
      <Slide dark mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: mobile ? '28px 20px' : '80px 120px' }}>
          <h2 style={{ fontSize: m(mobile, 56, 28), fontWeight: 800, lineHeight: 1.1, marginBottom: m(mobile, 12, 4) }}>Масштаб проблемы</h2>
          <p style={{ fontSize: m(mobile, 24, 14), color: '#94A3B8', marginBottom: m(mobile, 56, 20) }}>Что происходит в магазине с 500+ карточками</p>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: m(mobile, 28, 12) }}>
            {[
              { num: '500+', label: 'Карточек в среднем', icon: <Layers size={m(mobile, 32, 18)} /> },
              { num: '73%', label: 'Содержат ошибки', icon: <AlertTriangle size={m(mobile, 32, 18)} /> },
              { num: '120ч', label: 'На ручной аудит/мес', icon: <Clock size={m(mobile, 32, 18)} /> },
              { num: '−18%', label: 'Потери выручки', icon: <TrendingUp size={m(mobile, 32, 18)} /> },
            ].map((s, i) => (
              <div key={i} className="feature-card" style={{ textAlign: 'center', padding: m(mobile, 28, 14) }}>
                <div className="icon-circle" style={{ margin: '0 auto', marginBottom: m(mobile, 16, 6), width: m(mobile, 64, 32), height: m(mobile, 64, 32), borderRadius: m(mobile, 16, 8) }}>{s.icon}</div>
                <div style={{ fontSize: m(mobile, 72, 32), fontWeight: 800, lineHeight: 1, color: '#6C8EFF' }}>{s.num}</div>
                <div style={{ fontSize: m(mobile, 18, 12), color: '#94A3B8', marginTop: m(mobile, 8, 3) }}>{s.label}</div>
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
    render: (mobile) => (
      <Slide mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: mobile ? '28px 20px' : '80px 120px' }}>
          <h2 style={{ fontSize: m(mobile, 56, 28), fontWeight: 800, color: '#1E293B', marginBottom: m(mobile, 12, 4) }}>Как это работает сейчас</h2>
          <p style={{ fontSize: m(mobile, 24, 14), color: '#64748B', marginBottom: m(mobile, 40, 16) }}>Типичный день менеджера маркетплейса</p>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: m(mobile, 24, 10) }}>
            {[
              { title: 'Excel-таблицы', desc: 'Ручное ведение ошибок. Данные теряются и не синхронизируются.' },
              { title: 'Без приоритетов', desc: 'Нет понимания, какие ошибки критичны. Время уходит на мелочи.' },
              { title: 'Нет контроля команды', desc: 'Руководитель не видит, кто что делает.' },
              { title: 'Ответы вслепую', desc: 'На вопросы отвечают без контекста и анализа тональности.' },
            ].map((p, i) => (
              <div key={i} className="pain-card-light" style={{ display: 'flex', gap: m(mobile, 16, 8), alignItems: 'flex-start', padding: m(mobile, 28, 14) }}>
                <AlertTriangle size={m(mobile, 26, 14)} color="#EF4444" style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: m(mobile, 22, 15), fontWeight: 700, color: '#1E293B', marginBottom: m(mobile, 6, 2) }}>{p.title}</div>
                  <div style={{ fontSize: m(mobile, 17, 13), color: '#64748B', lineHeight: 1.4 }}>{p.desc}</div>
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
    render: (mobile) => (
      <Slide dark mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: mobile ? '28px 20px' : '80px 120px' }}>
          <h2 style={{ fontSize: m(mobile, 56, 28), fontWeight: 800, marginBottom: m(mobile, 12, 4) }}>Как работает WB Optimizer</h2>
          <p style={{ fontSize: m(mobile, 24, 14), color: '#94A3B8', marginBottom: m(mobile, 56, 18) }}>4 шага от хаоса к системе</p>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: m(mobile, 24, 10) }}>
            {[
              { step: 1, title: 'Подключение', desc: 'API магазина подключается автоматически', icon: <Zap size={m(mobile, 24, 14)} /> },
              { step: 2, title: 'Автоанализ', desc: 'ИИ сканирует карточки и группирует ошибки', icon: <Search size={m(mobile, 24, 14)} /> },
              { step: 3, title: 'Тикеты', desc: 'Каждая ошибка — тикет с ответственным', icon: <FileCheck size={m(mobile, 24, 14)} /> },
              { step: 4, title: 'Контроль', desc: 'Дашборд, согласования, метрики', icon: <Shield size={m(mobile, 24, 14)} /> },
            ].map((s, i) => (
              <div key={i} className="feature-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: m(mobile, 28, 14) }}>
                <div className="step-dot" style={{ marginBottom: m(mobile, 16, 6), width: m(mobile, 48, 28), height: m(mobile, 48, 28), fontSize: m(mobile, 20, 14) }}>{s.step}</div>
                <div style={{ fontSize: m(mobile, 22, 15), fontWeight: 700, marginBottom: m(mobile, 10, 3) }}>{s.title}</div>
                <div style={{ fontSize: m(mobile, 16, 12), color: '#94A3B8', lineHeight: 1.4 }}>{s.desc}</div>
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
    render: (mobile) => (
      <Slide mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', height: '100%', padding: mobile ? '28px 20px' : '80px 120px' }}>
          <div className="accent-line" style={{ marginBottom: m(mobile, 20, 8), width: m(mobile, 80, 40), height: m(mobile, 4, 3) }} />
          <h2 style={{ fontSize: m(mobile, 48, 28), fontWeight: 800, color: '#1E293B', marginBottom: m(mobile, 12, 4) }}>Аудит карточек</h2>
          <p style={{ fontSize: m(mobile, 18, 13), color: '#64748B', lineHeight: 1.5, marginBottom: m(mobile, 28, 10) }}>
            ИИ анализирует каждую карточку по 30+ параметрам
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: m(mobile, 18, 6), marginBottom: m(mobile, 28, 10) }}>
            {[
              { color: '#EF4444', label: 'Критичные', desc: 'Блокируют продажи' },
              { color: '#EAB308', label: 'Важные', desc: 'Снижают конверсию' },
              { color: '#22C55E', label: 'Улучшения', desc: 'Повышают качество' },
            ].map((z, i) => (
              <div key={i} style={{ display: 'flex', gap: m(mobile, 14, 8), alignItems: 'center' }}>
                <div style={{ width: m(mobile, 12, 8), height: m(mobile, 12, 8), borderRadius: '50%', background: z.color, flexShrink: 0 }} />
                <span style={{ fontSize: m(mobile, 18, 14), fontWeight: 700, color: '#1E293B' }}>{z.label}: </span>
                <span style={{ fontSize: m(mobile, 16, 13), color: '#64748B' }}>{z.desc}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr 1fr', gap: m(mobile, 20, 8) }}>
            {[
              { icon: <Search size={m(mobile, 26, 14)} />, title: 'Автоскан', desc: 'Синхронизация с WB API' },
              { icon: <Layers size={m(mobile, 26, 14)} />, title: 'Очередь задач', desc: 'Карточки с ошибками в очереди' },
              { icon: <Zap size={m(mobile, 26, 14)} />, title: 'Автоисправления', desc: 'Типовые ошибки в один клик' },
            ].map((f, i) => (
              <div key={i} className="feature-card-light" style={{ display: 'flex', gap: m(mobile, 16, 8), alignItems: 'center', padding: m(mobile, 24, 10) }}>
                <div className="icon-circle icon-circle-light" style={{ width: m(mobile, 52, 28), height: m(mobile, 52, 28), borderRadius: m(mobile, 14, 8) }}>{f.icon}</div>
                <div>
                  <div style={{ fontSize: m(mobile, 20, 14), fontWeight: 700, color: '#1E293B' }}>{f.title}</div>
                  <div style={{ fontSize: m(mobile, 16, 12), color: '#64748B' }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Slide>
    ),
  },

  /* 6 — Card Audit Deep Dive */
  {
    id: 6, title: 'Глубокий анализ', dark: false,
    render: (mobile) => (
      <Slide mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: mobile ? '28px 20px' : '80px 120px' }}>
          <div className="accent-line" style={{ marginBottom: m(mobile, 20, 8), width: m(mobile, 80, 40), height: m(mobile, 4, 3) }} />
          <h2 style={{ fontSize: m(mobile, 48, 26), fontWeight: 800, color: '#1E293B', marginBottom: m(mobile, 12, 4) }}>Глубокий анализ карточки</h2>
          <p style={{ fontSize: m(mobile, 18, 13), color: '#64748B', marginBottom: m(mobile, 40, 16) }}>Что проверяет система в каждой карточке</p>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr 1fr', gap: m(mobile, 28, 12) }}>
            {[
              { title: 'Контент', items: ['SEO-оптимизация заголовка', 'Ключевые слова', 'Полнота характеристик'], color: '#6C8EFF' },
              { title: 'Медиа', items: ['Качество фото', 'Наличие видео', 'Размерная сетка'], color: '#A78BFA' },
              { title: 'Коммерция', items: ['Цена vs конкуренты', 'Остатки на складах', 'Рейтинг и отзывы'], color: '#4F46E5' },
            ].map((col, i) => (
              <div key={i} className="feature-card-light" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ background: col.color, padding: mobile ? '8px 14px' : '16px 24px' }}>
                  <div style={{ fontSize: m(mobile, 22, 15), fontWeight: 700, color: 'white' }}>{col.title}</div>
                </div>
                <div style={{ padding: mobile ? '10px 14px' : '20px 24px', display: 'flex', flexDirection: 'column', gap: m(mobile, 16, 8) }}>
                  {col.items.map((item, j) => (
                    <div key={j} style={{ display: 'flex', gap: m(mobile, 12, 6), alignItems: 'center' }}>
                      <CheckCircle2 size={m(mobile, 20, 13)} color="#22C55E" style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: m(mobile, 17, 13), color: '#1E293B' }}>{item}</span>
                    </div>
                  ))}
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
    render: (mobile) => (
      <Slide mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', height: '100%', padding: mobile ? '28px 20px' : '80px 120px' }}>
          <div className="accent-line" style={{ marginBottom: m(mobile, 20, 8), width: m(mobile, 80, 40), height: m(mobile, 4, 3) }} />
          <h2 style={{ fontSize: m(mobile, 48, 28), fontWeight: 800, color: '#1E293B', marginBottom: m(mobile, 12, 4) }}>Фотостудия с ИИ</h2>
          <p style={{ fontSize: m(mobile, 18, 13), color: '#64748B', lineHeight: 1.5, marginBottom: m(mobile, 28, 10) }}>
            Генерация и редактирование контента прямо из карточки
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: m(mobile, 16, 8) }}>
            {[
              { icon: <Image size={m(mobile, 22, 14)} />, title: 'Генерация фото', desc: 'Создание изображений по описанию' },
              { icon: <Video size={m(mobile, 22, 14)} />, title: 'Генерация видео', desc: 'Короткие ролики за минуты' },
              { icon: <Camera size={m(mobile, 22, 14)} />, title: 'Из карточки', desc: 'Работает прямо из карточки товара' },
              { icon: <Settings size={m(mobile, 22, 14)} />, title: 'ИИ-редактор', desc: 'Удаление фона, ретушь, инфографика' },
            ].map((f, i) => (
              <div key={i} className="feature-card-light" style={{ display: 'flex', gap: m(mobile, 14, 8), alignItems: 'center', padding: m(mobile, 20, 10) }}>
                <div className="icon-circle icon-circle-light" style={{ width: m(mobile, 44, 28), height: m(mobile, 44, 28), borderRadius: m(mobile, 10, 7) }}>{f.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: m(mobile, 18, 14), fontWeight: 700, color: '#1E293B', marginBottom: m(mobile, 4, 1) }}>{f.title}</div>
                  <div style={{ fontSize: m(mobile, 15, 12), color: '#64748B', lineHeight: 1.4 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
          {!mobile && (
            <div style={{ marginTop: 32, display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: 280, height: 160, background: 'linear-gradient(135deg, #EEF2FF, #E0E7FF)', borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <Camera size={40} color="#6C8EFF" strokeWidth={1.5} />
                <div style={{ fontSize: 16, fontWeight: 700, color: '#4338CA' }}>AI Photo Studio</div>
              </div>
            </div>
          )}
        </div>
      </Slide>
    ),
  },

  /* 8 — Smart Q&A */
  {
    id: 8, title: 'Умные ответы', dark: true,
    render: (mobile) => (
      <Slide dark mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: mobile ? '28px 20px' : '80px 120px' }}>
          <div className="accent-line" style={{ marginBottom: m(mobile, 20, 8), width: m(mobile, 80, 40), height: m(mobile, 4, 3) }} />
          <h2 style={{ fontSize: m(mobile, 56, 28), fontWeight: 800, marginBottom: m(mobile, 12, 4) }}>Умные ответы на вопросы</h2>
          <p style={{ fontSize: m(mobile, 24, 13), color: '#94A3B8', marginBottom: m(mobile, 44, 16) }}>ИИ категоризирует вопросы и предлагает оптимальные ответы</p>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr 1fr', gap: m(mobile, 28, 12) }}>
            {[
              { icon: <Bot size={m(mobile, 34, 18)} />, title: 'ИИ-категоризация', desc: 'Сортировка по темам: доставка, качество, размеры' },
              { icon: <MessageSquare size={m(mobile, 34, 18)} />, title: 'Анализ тональности', desc: 'Определение настроения покупателя' },
              { icon: <Zap size={m(mobile, 34, 18)} />, title: 'Автоответы', desc: 'ИИ-генерация с учётом контекста товара' },
            ].map((f, i) => (
              <div key={i} className="feature-card" style={{ display: 'flex', flexDirection: mobile ? 'row' : 'column', alignItems: mobile ? 'center' : 'center', textAlign: mobile ? 'left' : 'center', padding: m(mobile, 28, 14), gap: mobile ? 10 : 0 }}>
                <div className="icon-circle" style={{ marginBottom: mobile ? 0 : 16, width: m(mobile, 64, 32), height: m(mobile, 64, 32), borderRadius: m(mobile, 16, 8) }}>{f.icon}</div>
                <div>
                  <div style={{ fontSize: m(mobile, 22, 15), fontWeight: 700, marginBottom: m(mobile, 10, 2) }}>{f.title}</div>
                  <div style={{ fontSize: m(mobile, 16, 12), color: '#94A3B8', lineHeight: 1.4 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Slide>
    ),
  },

  /* 9 — Q&A Deep Dive */
  {
    id: 9, title: 'Как работают ответы', dark: true,
    render: (mobile) => (
      <Slide dark mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', height: '100%', padding: mobile ? '28px 20px' : '80px 120px' }}>
          <div className="accent-line" style={{ marginBottom: m(mobile, 20, 8), width: m(mobile, 80, 40), height: m(mobile, 4, 3) }} />
          <h2 style={{ fontSize: m(mobile, 48, 28), fontWeight: 800, marginBottom: m(mobile, 28, 10) }}>Как работают умные ответы</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: m(mobile, 28, 12), marginBottom: m(mobile, 32, 12) }}>
            {[
              { n: 1, title: 'Вопрос поступает', desc: 'Покупатель задаёт вопрос' },
              { n: 2, title: 'ИИ анализирует', desc: 'Категория, тональность, срочность' },
              { n: 3, title: 'Генерация ответа', desc: 'На основе промптов и контекста' },
              { n: 4, title: 'Проверка', desc: 'Менеджер проверяет и публикует' },
            ].map((f, i) => (
              <div key={i} style={{ display: 'flex', gap: m(mobile, 16, 8), alignItems: 'center' }}>
                <div className="step-dot" style={{ width: m(mobile, 40, 24), height: m(mobile, 40, 24), fontSize: m(mobile, 16, 13) }}>{f.n}</div>
                <div>
                  <div style={{ fontSize: m(mobile, 20, 15), fontWeight: 700, marginBottom: 1 }}>{f.title}</div>
                  <div style={{ fontSize: m(mobile, 16, 12), color: '#94A3B8' }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="feature-card" style={{ padding: m(mobile, 32, 12) }}>
            <div style={{ fontSize: m(mobile, 22, 15), fontWeight: 700, color: '#6C8EFF', marginBottom: m(mobile, 20, 8) }}>Результаты</div>
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: m(mobile, 16, 5) }}>
              {[
                'Время ответа −70%',
                'Единый стиль коммуникации',
                'Негатив −25%',
                'Автоэскалация сложных вопросов',
              ].map((b, i) => (
                <div key={i} style={{ display: 'flex', gap: m(mobile, 12, 6), alignItems: 'center' }}>
                  <CheckCircle2 size={m(mobile, 20, 12)} color="#22C55E" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: m(mobile, 17, 13), color: '#CBD5E1' }}>{b}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Slide>
    ),
  },

  /* 10 — Recommendations */
  {
    id: 10, title: 'Рекомендации', dark: false,
    render: (mobile) => (
      <Slide mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', height: '100%', padding: mobile ? '28px 20px' : '80px 120px' }}>
          <div className="accent-line" style={{ marginBottom: m(mobile, 20, 8), width: m(mobile, 80, 40), height: m(mobile, 4, 3) }} />
          <h2 style={{ fontSize: m(mobile, 48, 28), fontWeight: 800, color: '#1E293B', marginBottom: m(mobile, 12, 4) }}>Рекомендации товаров</h2>
          <p style={{ fontSize: m(mobile, 18, 13), color: '#64748B', lineHeight: 1.5, marginBottom: m(mobile, 28, 10) }}>
            Автоматический подбор для кросс-продаж
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: m(mobile, 18, 6), marginBottom: m(mobile, 28, 10) }}>
            {[
              { icon: <Target size={m(mobile, 22, 14)} />, title: 'Автоподбор', desc: 'Сопутствующие товары для кросс-продаж' },
              { icon: <Settings size={m(mobile, 22, 14)} />, title: 'Профили', desc: 'Настраиваемые профили для категорий' },
              { icon: <Layers size={m(mobile, 22, 14)} />, title: 'Drag & Drop', desc: 'Управление порядком перетаскиванием' },
            ].map((f, i) => (
              <div key={i} style={{ display: 'flex', gap: m(mobile, 14, 8), alignItems: 'center' }}>
                <div className="icon-circle icon-circle-light" style={{ width: m(mobile, 44, 28), height: m(mobile, 44, 28), borderRadius: m(mobile, 10, 7) }}>{f.icon}</div>
                <div>
                  <div style={{ fontSize: m(mobile, 18, 14), fontWeight: 700, color: '#1E293B', marginBottom: m(mobile, 4, 1) }}>{f.title}</div>
                  <div style={{ fontSize: m(mobile, 16, 12), color: '#64748B', lineHeight: 1.4 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ background: '#F8FAFC', borderRadius: m(mobile, 16, 10), border: '1px solid #E2E8F0', padding: m(mobile, 20, 10), display: 'flex', flexDirection: 'column', gap: m(mobile, 10, 5) }}>
            {[1, 2, 3].map(n => (
              <div key={n} style={{ background: 'white', borderRadius: m(mobile, 10, 6), padding: m(mobile, 12, 6), border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: m(mobile, 12, 6) }}>
                <div style={{ width: m(mobile, 36, 20), height: m(mobile, 36, 20), borderRadius: m(mobile, 6, 4), background: `hsl(${220 + n * 20}, 70%, 95%)`, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: m(mobile, 8, 5), background: '#E2E8F0', borderRadius: 4, marginBottom: m(mobile, 4, 2), width: `${70 + n * 5}%` }} />
                  <div style={{ height: m(mobile, 6, 3), background: '#F1F5F9', borderRadius: 3, width: '50%' }} />
                </div>
                <Star size={m(mobile, 14, 10)} color="#EAB308" fill="#EAB308" style={{ flexShrink: 0 }} />
              </div>
            ))}
          </div>
        </div>
      </Slide>
    ),
  },

  /* 11 — Team & control */
  {
    id: 11, title: 'Команда', dark: true,
    render: (mobile) => (
      <Slide dark mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: mobile ? '28px 20px' : '80px 120px' }}>
          <div className="accent-line" style={{ marginBottom: m(mobile, 20, 8), width: m(mobile, 80, 40), height: m(mobile, 4, 3) }} />
          <h2 style={{ fontSize: m(mobile, 56, 28), fontWeight: 800, marginBottom: m(mobile, 12, 4) }}>Команда и контроль</h2>
          <p style={{ fontSize: m(mobile, 24, 13), color: '#94A3B8', marginBottom: m(mobile, 44, 16) }}>Полный контроль над процессами</p>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr 1fr', gap: m(mobile, 28, 12) }}>
            {[
              { icon: <Users size={m(mobile, 34, 18)} />, title: 'Роли и права', desc: 'Админ, менеджер, контент-мейкер — свой уровень доступа' },
              { icon: <Shield size={m(mobile, 34, 18)} />, title: 'Согласования', desc: 'Двухступенчатое согласование изменений' },
              { icon: <Activity size={m(mobile, 34, 18)} />, title: 'Аудит действий', desc: 'Кто, что и когда изменил — полная история' },
            ].map((f, i) => (
              <div key={i} className="feature-card" style={{ display: 'flex', flexDirection: mobile ? 'row' : 'column', alignItems: mobile ? 'center' : 'center', textAlign: mobile ? 'left' : 'center', padding: m(mobile, 28, 14), gap: mobile ? 10 : 0 }}>
                <div className="icon-circle" style={{ marginBottom: mobile ? 0 : 16, width: m(mobile, 64, 32), height: m(mobile, 64, 32), borderRadius: m(mobile, 16, 8) }}>{f.icon}</div>
                <div>
                  <div style={{ fontSize: m(mobile, 22, 15), fontWeight: 700, marginBottom: m(mobile, 10, 2) }}>{f.title}</div>
                  <div style={{ fontSize: m(mobile, 16, 12), color: '#94A3B8', lineHeight: 1.4 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Slide>
    ),
  },

  /* 12 — Security & Approvals */
  {
    id: 12, title: 'Безопасность', dark: false,
    render: (mobile) => (
      <Slide mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: mobile ? '28px 20px' : '80px 120px' }}>
          <div className="accent-line" style={{ marginBottom: m(mobile, 20, 8), width: m(mobile, 80, 40), height: m(mobile, 4, 3) }} />
          <h2 style={{ fontSize: m(mobile, 48, 26), fontWeight: 800, color: '#1E293B', marginBottom: m(mobile, 12, 4) }}>Безопасность и согласования</h2>
          <p style={{ fontSize: m(mobile, 18, 13), color: '#64748B', marginBottom: m(mobile, 36, 10) }}>Контроль на каждом уровне</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: m(mobile, 20, 8) }}>
            {[
              { icon: <Shield size={m(mobile, 24, 14)} />, title: 'Ролевая модель', desc: 'Сотрудник видит только разрешённые данные' },
              { icon: <Eye size={m(mobile, 24, 14)} />, title: 'Двойное согласование', desc: 'Критичные изменения требуют подтверждения' },
              { icon: <Activity size={m(mobile, 24, 14)} />, title: 'Журнал действий', desc: 'Полный аудит-трейл всех изменений' },
              { icon: <BarChart3 size={m(mobile, 24, 14)} />, title: 'Мониторинг', desc: 'Трекинг активности в реальном времени' },
            ].map((f, i) => (
              <div key={i} className="feature-card-light" style={{ display: 'flex', gap: m(mobile, 16, 8), alignItems: 'center', padding: mobile ? '10px 12px' : '20px 28px', borderLeft: `${m(mobile, 4, 3)}px solid #6C8EFF` }}>
                <div className="icon-circle icon-circle-light" style={{ width: m(mobile, 48, 28), height: m(mobile, 48, 28), borderRadius: m(mobile, 12, 7) }}>{f.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: m(mobile, 20, 14), fontWeight: 700, color: '#1E293B', marginBottom: m(mobile, 4, 1) }}>{f.title}</div>
                  <div style={{ fontSize: m(mobile, 16, 12), color: '#64748B', lineHeight: 1.4 }}>{f.desc}</div>
                </div>
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
    render: (mobile) => (
      <Slide dark mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', padding: mobile ? '28px 20px' : '80px 120px' }}>
          <h2 style={{ fontSize: m(mobile, 56, 28), fontWeight: 800, marginBottom: m(mobile, 12, 4) }}>ROI: цифры говорят сами</h2>
          <p style={{ fontSize: m(mobile, 24, 13), color: '#94A3B8', marginBottom: m(mobile, 48, 18) }}>Результаты за первые 3 месяца</p>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr 1fr', gap: m(mobile, 40, 8) }}>
            {[
              { num: '−80%', label: 'Времени на аудит', sub: '120ч → 24ч/мес' },
              { num: '+35%', label: 'Качество карточек', sub: 'Больше карточек без ошибок' },
              { num: '×3', label: 'Скорость команды', sub: 'Очередь задач + автоматизация' },
            ].map((r, i) => (
              <div key={i} className="feature-card" style={{ textAlign: 'center', padding: m(mobile, 28, 16) }}>
                <div style={{ fontSize: m(mobile, 72, 36), fontWeight: 800, color: '#6C8EFF', lineHeight: 1, marginBottom: m(mobile, 10, 4) }}>{r.num}</div>
                <div style={{ fontSize: m(mobile, 22, 15), fontWeight: 700, marginBottom: m(mobile, 6, 2) }}>{r.label}</div>
                <div style={{ fontSize: m(mobile, 16, 12), color: '#94A3B8' }}>{r.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: m(mobile, 40, 12), background: 'rgba(108, 142, 255, 0.08)', borderRadius: m(mobile, 16, 10), padding: mobile ? '12px 14px' : '24px 36px', display: 'flex', alignItems: 'center', gap: m(mobile, 16, 8) }}>
            <DollarSign size={m(mobile, 28, 16)} color="#6C8EFF" style={{ flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: m(mobile, 20, 15), fontWeight: 700 }}>Окупаемость за 2-4 недели</div>
              <div style={{ fontSize: m(mobile, 16, 12), color: '#94A3B8' }}>Платформа окупается в первый месяц</div>
            </div>
          </div>
        </div>
      </Slide>
    ),
  },

  /* 14 — CTA */
  {
    id: 14, title: 'Подключение', dark: true,
    render: (mobile) => (
      <Slide dark mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', textAlign: 'center', padding: mobile ? '28px 20px' : '80px 160px' }}>
          <h2 style={{ fontSize: m(mobile, 56, 28), fontWeight: 800, marginBottom: m(mobile, 12, 4) }}>Начните за 15 минут</h2>
          <p style={{ fontSize: m(mobile, 24, 14), color: '#94A3B8', marginBottom: m(mobile, 48, 18) }}>Три шага к автоматизации</p>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr 1fr', gap: m(mobile, 32, 8), marginBottom: m(mobile, 48, 16), width: '100%' }}>
            {[
              { step: 1, title: 'Регистрация', desc: 'Создайте аккаунт, подключите магазин' },
              { step: 2, title: 'Автоанализ', desc: 'Скан всех карточек за 10 минут' },
              { step: 3, title: 'Работа', desc: 'Задачи команде, контроль прогресса' },
            ].map((s, i) => (
              <div key={i} className="feature-card" style={{ display: 'flex', flexDirection: mobile ? 'row' : 'column', alignItems: mobile ? 'center' : 'center', padding: m(mobile, 28, 14), gap: mobile ? 10 : 0 }}>
                <div className="step-dot" style={{ marginBottom: mobile ? 0 : 16, width: m(mobile, 48, 28), height: m(mobile, 48, 28), fontSize: m(mobile, 20, 14) }}>{s.step}</div>
                <div style={{ textAlign: mobile ? 'left' : 'center' }}>
                  <div style={{ fontSize: m(mobile, 22, 15), fontWeight: 700, marginBottom: m(mobile, 8, 2) }}>{s.title}</div>
                  <div style={{ fontSize: m(mobile, 16, 12), color: '#94A3B8', lineHeight: 1.4 }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <button className="cta-button" style={{ padding: mobile ? '12px 28px' : '20px 48px', fontSize: m(mobile, 22, 16), borderRadius: m(mobile, 12, 8) }}>
            <Rocket size={m(mobile, 22, 14)} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
            Начать бесплатно
          </button>
        </div>
      </Slide>
    ),
  },

  /* 15 — Contacts */
  {
    id: 15, title: 'Контакты', dark: true,
    render: (mobile) => (
      <Slide dark mobile={mobile}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', textAlign: 'center', padding: mobile ? '32px 24px' : '80px 160px' }}>
          <div style={{ fontSize: m(mobile, 18, 13), fontWeight: 600, color: '#6C8EFF', letterSpacing: mobile ? 2 : 4, textTransform: 'uppercase', marginBottom: m(mobile, 28, 12) }}>
            WB Optimizer
          </div>
          <h2 style={{ fontSize: m(mobile, 56, 30), fontWeight: 800, marginBottom: m(mobile, 44, 16) }}>Давайте обсудим</h2>
          <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: m(mobile, 40, 12), marginBottom: m(mobile, 48, 16) }}>
            {[
              { icon: <Mail size={m(mobile, 26, 16)} />, label: 'viktoriya_bezko@mail.ru' },
              { icon: <Phone size={m(mobile, 26, 16)} />, label: '+7 (915) 173-39-39' },
            ].map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: m(mobile, 12, 8) }}>
                <div className="icon-circle" style={{ width: m(mobile, 64, 34), height: m(mobile, 64, 34), borderRadius: m(mobile, 16, 8) }}>{c.icon}</div>
                <span style={{ fontSize: m(mobile, 18, 14), color: '#CBD5E1' }}>{c.label}</span>
              </div>
            ))}
          </div>
          <div className="accent-line" style={{ margin: `0 auto ${m(mobile, 28, 12)}px`, width: m(mobile, 80, 48), height: m(mobile, 4, 3) }} />
          <p style={{ fontSize: m(mobile, 18, 14), color: '#64748B' }}>Спасибо за внимание</p>
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
        {slide.render(false)}
      </div>
      <div className="pres-thumb-num">{index + 1}</div>
    </div>
  );
}

/* ───────── Mobile dots ───────── */
function MobileDots({ total, current, onDot }: { total: number; current: number; onDot: (i: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', padding: '8px 0' }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          onClick={() => onDot(i)}
          style={{
            width: i === current ? 18 : 6,
            height: 6,
            borderRadius: 3,
            background: i === current ? '#6C8EFF' : 'rgba(255,255,255,0.25)',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        />
      ))}
    </div>
  );
}

/* ───────── Main ───────── */
export default function PresentationFullPage() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [isMobile, setIsMobile] = useState(false);

  /* detect mobile */
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const updateScale = useCallback(() => {
    if (!viewportRef.current) return;
    const { clientWidth: w, clientHeight: h } = viewportRef.current;
    if (isMobile) {
      // On mobile, scale a 390x(h) slide to fill viewport
      setScale(1); // native rendering, no scaling
    } else {
      setScale(Math.min(w / 1920, h / 1080));
    }
  }, [isMobile]);

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

  /* Mobile swipe */
  const touchStart = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => { touchStart.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart.current === null) return;
    const diff = touchStart.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) { diff > 0 ? next() : prev(); }
    touchStart.current = null;
  };

  /* ─── Mobile layout ─── */
  if (isMobile) {
    return (
      <div
        className="pres-root-mobile"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="pres-mobile-header">
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#94A3B8', padding: 4, cursor: 'pointer' }}>
            <X size={18} />
          </button>
          <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 600 }}>{current + 1} / {slides.length}</span>
          <div style={{ width: 18 }} />
        </div>

        <div className="pres-mobile-viewport" ref={viewportRef}>
          {slides[current].render(true)}
        </div>

        <div className="pres-mobile-footer">
          <MobileDots total={slides.length} current={current} onDot={setCurrent} />
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 16px 0' }}>
            <button onClick={prev} disabled={current === 0} className="pres-mobile-nav">
              <ChevronLeft size={20} />
            </button>
            <button onClick={next} disabled={current === slides.length - 1} className="pres-mobile-nav">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Desktop layout ─── */
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
            {slides[current].render(false)}
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
