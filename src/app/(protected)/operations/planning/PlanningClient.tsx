'use client';

import React, { useState, useEffect } from 'react';
import { Button, InputNumber, Spin, Typography, Tooltip, Badge, DatePicker, Modal, message } from 'antd';
import {
  LeftOutlined, RightOutlined, CheckOutlined, DownOutlined,
  CheckCircleFilled, ExclamationCircleFilled, CloseCircleFilled,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import isoWeek from 'dayjs/plugin/isoWeek';
import Link from 'next/link';
import { getPlanningData, createPlanningRequest } from '@/lib/actions/planning';
import { buildPortyanka } from '@/lib/actions/portyanka';

dayjs.extend(isoWeek);
dayjs.locale('ru');

const { Text } = Typography;

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

type DayKey = typeof DAYS[number];

type Schedule = {
  id: string;
  customerContractId: string;
  directionId: string | null;
  originLocationId: string | null;
  destinationLocationId: string | null;
  mon: number | null; tue: number | null; wed: number | null;
  thu: number | null; fri: number | null; sat: number | null; sun: number | null;
  requestTemplateId: string | null;
  customerContract: { id: string; contractNumber: string; customer: { id: string; name: string } };
  direction: { id: string; origin: { id: string; name: string }; destination: { id: string; name: string } } | null;
  originLocation: { id: string; name: string } | null;
  destinationLocation: { id: string; name: string } | null;
  requestTemplate: { id: string; name: string } | null;
  // Направление из первого магистрального плеча шаблона (считается на сервере)
  magistralDirection: { id: string; code: string; name: string | null; originName: string | null; destinationName: string | null } | null;
  // Плечи ПОСЛЕ магистрального: перевозки из транзитного города (Казань → Ижевск).
  // Тот же груз и та же заявка, но другая машина — показываем отдельной группой,
  // только для чтения. Ввод остаётся в городе отправления.
  onward: {
    directionId: string; code: string; name: string | null;
    originName: string | null; destinationName: string | null;
    legDestinationName: string | null;
    dayShift: number;
  }[];
};

type Req = {
  id: string;
  requestNumber: string;
  customerId: string;
  pickupLocationId: string | null;
  deliveryLocationId: string | null;
  pickupDate: string | null;
  requestedPallets: number | null;
  status: string;
};

type PlanningData = { schedules: Schedule[]; requests: Req[] };

function originId(s: Schedule) { return s.direction?.origin?.id ?? s.originLocationId ?? ''; }
function destId(s: Schedule) { return s.direction?.destination?.id ?? s.destinationLocationId ?? ''; }
function originName(s: Schedule) { return s.direction?.origin?.name ?? s.originLocation?.name ?? '?'; }
function destName(s: Schedule) { return s.direction?.destination?.name ?? s.destinationLocation?.name ?? '?'; }

// Совпадает со statusCfg в /requests и /requests/[id] — статус должен выглядеть
// одинаково во всём приложении.
const statusCfg: Record<string, { color: string; label: string }> = {
  NEW: { color: 'blue', label: 'Новая' },
  CONFIRMED: { color: 'cyan', label: 'Подтверждена' },
  IN_PLANNING: { color: 'geekblue', label: 'В планировании' },
  IN_TRANSIT: { color: 'orange', label: 'В пути' },
  DELIVERED: { color: 'green', label: 'Доставлена' },
  CANCELLED: { color: 'red', label: 'Отменена' },
};

export default function PlanningClient({ initialData, initialWeek }: { initialData: PlanningData; initialWeek: string }) {
  const [weekStart, setWeekStart] = useState(() => dayjs(initialWeek).startOf('isoWeek'));
  const [data, setData] = useState<PlanningData>(initialData);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());

  // Направлений больше двух десятков, и все развёрнутые не читаются. По умолчанию
  // свёрнуто: видны только названия, объём вводится в развёрнутой группе.
  // Развёрнутые запоминаем в localStorage — как collapsed у бокового меню.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem('planning:expanded');
      if (raw) setExpanded(new Set(JSON.parse(raw) as string[]));
    } catch { /* повреждённое значение просто игнорируем */ }
  }, []);
  function toggleGroup(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem('planning:expanded', JSON.stringify(Array.from(next))); } catch { /* приватный режим */ }
      return next;
    });
  }

  const weekDates = DAYS.map((_, i) => weekStart.add(i, 'day'));
  const todayStr = dayjs().format('YYYY-MM-DD');

  // ВРЕМЕННОЕ: портянка — письмо с объёмами на день для подрядчиков и складов.
  // Дата по умолчанию — завтра: письмо шлют накануне отгрузки.
  const [portDate, setPortDate] = useState(() => dayjs().add(1, 'day'));
  const [portText, setPortText] = useState<string | null>(null);
  const [portLoading, setPortLoading] = useState(false);

  async function handlePortyanka() {
    setPortLoading(true);
    try {
      setPortText(await buildPortyanka(portDate.format('YYYY-MM-DD')));
    } catch (e) {
      message.error('Не удалось собрать портянку: ' + (e as Error).message);
    } finally {
      setPortLoading(false);
    }
  }

  async function loadWeek(start: dayjs.Dayjs) {
    setLoading(true);
    const s = start.startOf('isoWeek');
    setWeekStart(s);
    try {
      const fresh = await getPlanningData(s.toISOString()) as PlanningData;
      setData(fresh);
      setPending({});
    } finally {
      setLoading(false);
    }
  }

  // Группируем по НАПРАВЛЕНИЮ из справочника: по направлению планируется одна
  // машина, которая делает несколько выгрузок по маршруту. Поэтому графики с
  // разными конечными точками должны быть в одной группе — только так видно
  // суммарный объём на день (строка «Итого» внизу группы).
  // Графики без разрешённого направления не теряем — сводим в отдельные группы
  // по паре локаций, чтобы их было видно и можно было починить.
  // Строка сетки. Обычная строка редактируется, строка транзитного города —
  // только для чтения: это тот же груз, введённый в городе отправления.
  type Row = {
    key: string;
    destName: string;
    customerId: string;
    customerName: string;
    contractNumber: string;
    oId: string;
    dId: string;
    days: (number | null)[];
    dayShift: number;
    schedule: Schedule | null; // null → только для чтения
  };
  type Group = { key: string; title: string; subtitle: string | null; rows: Row[] };
  const groupMap = new Map<string, Group>();

  function ensureGroup(key: string, title: string, subtitle: string | null) {
    if (!groupMap.has(key)) groupMap.set(key, { key, title, subtitle, rows: [] });
    return groupMap.get(key)!;
  }

  for (const s of data.schedules) {
    const md = s.magistralDirection;
    const key = md ? `dir:${md.id}` : `pair:${originId(s)}_${destId(s)}`;
    const g = ensureGroup(
      key,
      md ? `${md.code}${md.name ? ` · ${md.name}` : ''}` : `${originName(s)} → ${destName(s)}`,
      md
        ? (md.originName && md.destinationName ? `${md.originName} → ${md.destinationName}` : null)
        : 'направление не определено — у графика нет шаблона с магистральным плечом',
    );
    g.rows.push({
      key: s.id,
      destName: destName(s),
      customerId: s.customerContract.customer.id,
      customerName: s.customerContract.customer.name,
      contractNumber: s.customerContract.contractNumber,
      oId: originId(s),
      dId: destId(s),
      days: DAYS.map((d) => s[d]),
      dayShift: 0,
      schedule: s,
    });

    // Эхо в группе транзитного города: дни сдвинуты на смещение забора этого плеча.
    // Сдвиг по модулю недели — поэтому в понедельник видна заявка воскресенья
    // прошлой недели, и заявки за неделю до начала периода сервер тоже отдаёт.
    for (const on of s.onward ?? []) {
      const og = ensureGroup(
        `dir:${on.directionId}`,
        `${on.code}${on.name ? ` · ${on.name}` : ''}`,
        on.originName && on.destinationName ? `${on.originName} → ${on.destinationName}` : null,
      );
      og.rows.push({
        key: `${s.id}__${on.directionId}`,
        destName: on.legDestinationName ?? on.destinationName ?? '?',
        customerId: s.customerContract.customer.id,
        customerName: s.customerContract.customer.name,
        contractNumber: s.customerContract.contractNumber,
        oId: originId(s),
        dId: destId(s),
        days: DAYS.map((_, i) => s[DAYS[(i - on.dayShift + 7) % 7]]),
        dayShift: on.dayShift,
        schedule: null,
      });
    }
  }
  const groups = Array.from(groupMap.values());
  // Внутри группы — как в рабочем файле: по конечной точке, затем по клиенту.
  // Редактируемые строки выше строк транзитного города: сначала то, что планируют.
  for (const g of groups) {
    g.rows.sort((a, b) =>
      Number(!a.schedule) - Number(!b.schedule) ||
      a.destName.localeCompare(b.destName, 'ru') ||
      a.customerName.localeCompare(b.customerName, 'ru')
    );
  }

  function findRequest(customerId: string, oId: string, dId: string, dayDate: dayjs.Dayjs): Req | undefined {
    const dayStr = dayDate.format('YYYY-MM-DD');
    return data.requests.find(r =>
      r.customerId === customerId &&
      r.pickupLocationId === oId &&
      r.deliveryLocationId === dId &&
      r.pickupDate?.startsWith(dayStr),
    );
  }

  // Готовность направления к ЗАВТРАШНЕЙ отгрузке: сколько строк, по которым завтра
  // возим, уже имеют заявку. Свёрнутая группа этим и живёт — по индикатору видно,
  // куда лезть, не разворачивая все 28.
  //
  // Считаем только редактируемые строки: транзитные показывают ТЕ ЖЕ заявки,
  // и их учёт удвоил бы и знаменатель, и числитель.
  // Если завтра не попадает в показываемую неделю (например в воскресенье) —
  // индикатора нет: данных за пределами недели у нас не запрошено.
  const tomorrow = dayjs().add(1, 'day');
  const tomorrowIdx = weekDates.findIndex(d => d.isSame(tomorrow, 'day'));

  function readiness(rows: Row[]): { filled: number; scheduled: number } | null {
    if (tomorrowIdx < 0) return null;
    const dayDate = weekDates[tomorrowIdx];
    let scheduled = 0;
    let filled = 0;
    for (const row of rows) {
      if (!row.schedule) continue;              // транзитная строка — не планируется здесь
      if (row.days[tomorrowIdx] == null) continue; // в этот день не возим
      scheduled++;
      if (findRequest(row.customerId, row.oId, row.dId, dayDate)) filled++;
    }
    return scheduled ? { filled, scheduled } : null;
  }

  async function handleSave(s: Schedule, dayIdx: number) {
    const dayDate = weekDates[dayIdx];
    const oId = originId(s);
    const dId = destId(s);
    const ck = `${s.customerContract.customer.id}__${oId}__${dId}__${dayDate.format('YYYY-MM-DD')}`;
    const pallets = pending[ck];
    if (!pallets || pallets <= 0) return;

    setSaving(prev => new Set(prev).add(ck));
    try {
      await createPlanningRequest({
        customerId: s.customerContract.customer.id,
        pickupLocationId: oId,
        deliveryLocationId: dId,
        pickupDate: dayDate.format('YYYY-MM-DD'),
        requestedPallets: pallets,
        transitDays: s[DAYS[dayIdx]] ?? null,
        requestTemplateId: s.requestTemplateId ?? null,
      });
      const fresh = await getPlanningData(weekStart.toISOString()) as PlanningData;
      setData(fresh);
      setPending(prev => { const n = { ...prev }; delete n[ck]; return n; });
    } finally {
      setSaving(prev => { const n = new Set(prev); n.delete(ck); return n; });
    }
  }

  const thBase: React.CSSProperties = {
    padding: '8px 10px', fontWeight: 500, fontSize: 12,
    borderBottom: '2px solid #f0f0f0', whiteSpace: 'nowrap', background: '#fafafa',
  };
  const tdBase: React.CSSProperties = {
    padding: '8px 10px', verticalAlign: 'middle', borderBottom: '1px solid #f5f5f5',
  };
  // Колонка «Клиент» узкая и с переносом — иначе 7 колонок дней не влезают
  // в карточку и неделя уезжает под горизонтальную прокрутку.
  const CLIENT_COL = 120;
  const clientColStyle: React.CSSProperties = {
    width: CLIENT_COL, minWidth: CLIENT_COL, maxWidth: CLIENT_COL,
    whiteSpace: 'normal', overflowWrap: 'anywhere',
  };
  const DEST_COL = 140;
  const destColStyle: React.CSSProperties = {
    width: DEST_COL, minWidth: DEST_COL, maxWidth: DEST_COL,
    whiteSpace: 'normal', overflowWrap: 'anywhere',
  };
  // Ячейки дней: узкие боковые отступы. Именно они задают минимальную ширину,
  // до которой таблица может сжаться; width:96 у th остаётся как предпочтение —
  // на широком экране колонки просторные, на узком сжимаются без прокрутки.
  const dayCellBase: React.CSSProperties = { ...tdBase, padding: '8px 4px', textAlign: 'center' };

  return (
    <div>
      {/* Week selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Button size="small" icon={<LeftOutlined />} onClick={() => loadWeek(weekStart.subtract(1, 'week'))} />
        <Text strong style={{ fontSize: 14, minWidth: 200, textAlign: 'center' }}>
          {weekStart.format('D MMM')} — {weekStart.add(6, 'day').format('D MMM YYYY')}
        </Text>
        <Button size="small" icon={<RightOutlined />} onClick={() => loadWeek(weekStart.add(1, 'week'))} />
        <Button type="link" size="small" onClick={() => loadWeek(dayjs())} style={{ color: '#888' }}>
          Сегодня
        </Button>
        {loading && <Spin size="small" />}

        {/* ВРЕМЕННОЕ: вывод портянки. Удаляется вместе с actions/portyanka.ts. */}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <DatePicker
            size="small"
            value={portDate}
            onChange={(d) => d && setPortDate(d)}
            format="DD.MM.YYYY"
            allowClear={false}
          />
          <Button size="small" loading={portLoading} onClick={handlePortyanka}>
            Вывести портянку
          </Button>
        </span>
      </div>

      <Modal
        open={portText !== null}
        onCancel={() => setPortText(null)}
        title={`Портянка на ${portDate.format('DD.MM.YYYY')}`}
        width={720}
        footer={[
          <Button
            key="copy"
            onClick={() => {
              navigator.clipboard.writeText(portText ?? '');
              message.success('Скопировано');
            }}
          >
            Скопировать
          </Button>,
          <Button key="close" type="primary" onClick={() => setPortText(null)}>
            Закрыть
          </Button>,
        ]}
      >
        {/* Именно текстом: письмо уходит копипастой, без таблиц и разметки. */}
        <pre
          style={{
            whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13,
            maxHeight: '60vh', overflowY: 'auto', margin: 0,
          }}
        >
          {portText}
        </pre>
      </Modal>

      {groups.length === 0 && (
        <div style={{ textAlign: 'center', color: '#888', padding: 48 }}>
          Нет направлений с расписаниями. Добавьте расписание в карточке договора.
        </div>
      )}

      {groups.map(group => {
        const isExpanded = expanded.has(group.key);
        return (
        <div
          key={group.key}
          style={{ marginBottom: isExpanded ? 20 : 8, background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' }}
        >
          {/* Шапка — переключатель. Свёрнуто по умолчанию: направлений больше двух
              десятков, развёрнутыми они не читаются. Клик по всей полосе, не только
              по стрелке: попасть в узкую иконку мышью неудобно. */}
          <div
            onClick={() => toggleGroup(group.key)}
            style={{
              padding: '10px 16px',
              borderBottom: isExpanded ? '1px solid #f0f0f0' : undefined,
              background: '#fafafa',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              userSelect: 'none',
            }}
          >
            {isExpanded
              ? <DownOutlined style={{ fontSize: 10, color: '#888' }} />
              : <RightOutlined style={{ fontSize: 10, color: '#888' }} />}
            {(() => {
              const r = readiness(group.rows);
              if (!r) return null;
              const dayLabel = `${DAY_SHORT[tomorrowIdx].toLowerCase()} ${weekDates[tomorrowIdx].format('D MMM')}`;
              if (r.filled === 0) {
                return (
                  <Tooltip title={`Отгрузка ${dayLabel}: не заполнено ни одной строки из ${r.scheduled}`}>
                    <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 14 }} />
                  </Tooltip>
                );
              }
              if (r.filled < r.scheduled) {
                return (
                  <Tooltip title={`Отгрузка ${dayLabel}: заполнено ${r.filled} из ${r.scheduled}`}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <ExclamationCircleFilled style={{ color: '#faad14', fontSize: 14 }} />
                      <Text style={{ fontSize: 11, color: '#ad6800', fontVariantNumeric: 'tabular-nums' }}>
                        {r.filled}/{r.scheduled}
                      </Text>
                    </span>
                  </Tooltip>
                );
              }
              return (
                <Tooltip title={`Отгрузка ${dayLabel}: заполнены все ${r.scheduled}`}>
                  <CheckCircleFilled style={{ color: '#52c41a', fontSize: 14 }} />
                </Tooltip>
              );
            })()}
            <Text strong style={{ fontSize: 13 }}>{group.title}</Text>
            {group.subtitle && (
              <Text type="secondary" style={{ fontSize: 11 }}>{group.subtitle}</Text>
            )}
            {!isExpanded && (
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                {group.rows.length} {group.rows.length === 1 ? 'строка' : group.rows.length < 5 ? 'строки' : 'строк'}
              </Text>
            )}
          </div>
          <div style={{ overflowX: 'auto', display: isExpanded ? undefined : 'none' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...thBase, textAlign: 'left', ...destColStyle }}>Куда (конечное)</th>
                  <th style={{ ...thBase, textAlign: 'left', ...clientColStyle }}>Клиент</th>
                  {weekDates.map((d, i) => {
                    const dStr = d.format('YYYY-MM-DD');
                    const isToday = dStr === todayStr;
                    const isWe = i >= 5;
                    return (
                      <th key={i} style={{ ...thBase, textAlign: 'center', width: 96, color: isToday ? '#1677ff' : isWe ? '#ff4d4f' : undefined, background: isToday ? '#e6f4ff' : '#fafafa' }}>
                        <div>{DAY_SHORT[i]}</div>
                        <div style={{ fontWeight: 400, fontSize: 10, opacity: 0.7 }}>{d.format('D MMM')}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {group.rows.map(row => {
                  const cid = row.customerId;
                  const readOnly = !row.schedule;
                  return (
                    <tr key={row.key}>
                      <td style={{ ...tdBase, textAlign: 'left', ...destColStyle, background: readOnly ? '#fafafa' : undefined }}>
                        <div style={{ fontWeight: 500, lineHeight: 1.3 }}>{row.destName}</div>
                      </td>
                      <td style={{ ...tdBase, textAlign: 'left', ...clientColStyle, background: readOnly ? '#fafafa' : undefined }}>
                        <div style={{ lineHeight: 1.3 }}>{row.customerName}</div>
                        <div style={{ color: '#aaa', fontSize: 11 }}>
                          {row.contractNumber}
                          {readOnly && (
                            <Tooltip title={`Тот же груз, что запланирован в городе отправления, — здесь он на ${row.dayShift} дн. позже. Ввод только там, иначе паллеты посчитаются дважды.`}>
                              <span style={{ marginLeft: 6, color: '#bfbfbf' }}>· транзит</span>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                      {DAYS.map((day: DayKey, i) => {
                        // null = в этот день не возим; 0 = доставка в день забора.
                        // Проверять на «ложность» нельзя — ноль это валидный срок.
                        const transit = row.days[i];
                        const scheduled = transit != null;
                        const dayDate = weekDates[i];
                        const dStr = dayDate.format('YYYY-MM-DD');
                        const isToday = dStr === todayStr;
                        // Локации берём ИЗ СТРОКИ, не из группы: в одной группе
                        // (одно направление) разные конечные точки.
                        const sOid = row.oId;
                        const sDid = row.dId;
                        const ck = `${cid}__${sOid}__${sDid}__${dStr}`;
                        // У строки транзитного города заявка забиралась раньше на dayShift дней
                        const reqDate = row.dayShift ? dayDate.subtract(row.dayShift, 'day') : dayDate;
                        const existingReq = findRequest(cid, sOid, sDid, reqDate);
                        const isSaving = saving.has(ck);
                        const val = pending[ck] ?? null;

                        // ЗАЯВКА ПОКАЗЫВАЕТСЯ ВСЕГДА — проверка идёт ДО графика.
                        // Иначе разовые отгрузки и заявки, созданные до правки
                        // графика, исчезают из сетки, оставаясь живыми в базе.
                        if (existingReq) {
                          const offSchedule = !scheduled;
                          return (
                            <td key={day} style={{ ...dayCellBase, background: isToday ? '#e6f4ff' : undefined }}>
                              {/* Компактная плашка: сам объём и есть ссылка на заявку.
                                  Номер заявки распирал таблицу — убран в подсказку.
                                  Вне графика — пунктир и янтарный цвет: видно, что отклонение. */}
                              <Link href={`/requests/${existingReq.id}`}>
                                <Tooltip
                                  title={`${existingReq.requestNumber} · ${statusCfg[existingReq.status]?.label ?? existingReq.status}${offSchedule ? ' · вне графика' : ''}`}
                                >
                                  <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                    background: offSchedule ? '#fff7e6' : '#f0f9ff',
                                    border: `1px ${offSchedule ? 'dashed' : 'solid'} ${offSchedule ? '#ffd591' : '#bae0ff'}`,
                                    borderRadius: 6, padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap',
                                  }}>
                                    <Badge color={statusCfg[existingReq.status]?.color ?? 'default'} />
                                    <span style={{ fontWeight: 600, color: offSchedule ? '#ad6800' : '#0958d9' }}>{existingReq.requestedPallets ?? '?'} пал</span>
                                  </span>
                                </Tooltip>
                              </Link>
                            </td>
                          );
                        }

                        if (!scheduled) {
                          return (
                            <td key={day} style={{ ...dayCellBase, background: isToday ? '#fafeff' : readOnly ? '#fafafa' : undefined }}>
                              <span style={{ color: '#e0e0e0' }}>—</span>
                            </td>
                          );
                        }

                        // Строка транзитного города: поля ввода нет. День по графику есть,
                        // но заявку ещё не создали в городе отправления — показываем это,
                        // чтобы было видно ожидаемую отгрузку.
                        if (readOnly) {
                          return (
                            <td key={day} style={{ ...dayCellBase, background: isToday ? '#fafeff' : '#fafafa' }}>
                              <Tooltip title="По графику отгрузка есть, но заявка в городе отправления пока не создана">
                                <span style={{ color: '#bfbfbf', fontSize: 11 }}>ждём</span>
                              </Tooltip>
                            </td>
                          );
                        }

                        return (
                          <td key={day} style={{ ...dayCellBase, background: isToday ? '#fafeff' : '#fffbe6' }}>
                            <Spin spinning={isSaving} size="small">
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
                                <InputNumber
                                  size="small"
                                  min={1} max={999} precision={0}
                                  placeholder="пал"
                                  value={val ?? undefined}
                                  onChange={v => setPending(prev => ({ ...prev, [ck]: v ?? null }))}
                                  onPressEnter={() => handleSave(row.schedule!, i)}
                                  style={{ width: 58 }}
                                />
                                {val && val > 0 && (
                                  <Button
                                    type="primary" size="small" icon={<CheckOutlined />}
                                    onClick={() => handleSave(row.schedule!, i)}
                                    style={{ padding: '0 5px' }}
                                  />
                                )}
                              </div>
                            </Spin>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              {/* Итог по дню на всё направление: по нему планируется одна машина,
                  поэтому суммарный объём — главное число этой таблицы.
                  Считаем уже созданные заявки плюс ещё не сохранённый ввод. */}
              <tfoot>
                <tr>
                  <td style={{ ...tdBase, ...destColStyle, borderTop: '2px solid #f0f0f0', fontWeight: 600 }}>Итого</td>
                  <td style={{ ...tdBase, ...clientColStyle, borderTop: '2px solid #f0f0f0' }} />
                  {DAYS.map((day: DayKey, i) => {
                    const dayDate = weekDates[i];
                    const dStr = dayDate.format('YYYY-MM-DD');
                    const isToday = dStr === todayStr;
                    let total = 0;
                    for (const row of group.rows) {
                      const cid2 = row.customerId;
                      const sOid = row.oId;
                      const sDid = row.dId;
                      // Заявки считаем всегда, даже вне графика — машину под них
                      // всё равно надо заказывать. Незаписанный ввод возможен
                      // только там, где есть поле, то есть в редактируемой строке.
                      const reqDate = row.dayShift ? dayDate.subtract(row.dayShift, 'day') : dayDate;
                      const req = findRequest(cid2, sOid, sDid, reqDate);
                      if (req) total += req.requestedPallets ?? 0;
                      else if (row.schedule && row.days[i] != null) total += pending[`${cid2}__${sOid}__${sDid}__${dStr}`] ?? 0;
                    }
                    return (
                      <td
                        key={day}
                        style={{
                          ...dayCellBase,
                          borderTop: '2px solid #f0f0f0',
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          background: isToday ? '#e6f4ff' : '#fafafa',
                          color: total > 0 ? undefined : '#ccc',
                        }}
                      >
                        {total > 0 ? total : '—'}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        );
      })}
    </div>
  );
}
