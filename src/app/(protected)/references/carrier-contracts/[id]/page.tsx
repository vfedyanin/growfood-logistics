'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Button, Form, Input, DatePicker, Space, Popconfirm, Tag, message,
  Descriptions, Typography, Spin, InputNumber, Switch, Modal, Radio,
} from 'antd';
import { ArrowLeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined, HistoryOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { DirectionSelect, LocationSelect } from '@/components/selects/EntitySelects';
import { getVehicleTypes } from '@/lib/actions/references';
import {
  getCarrierContractDetail, updateCarrierContractNotes,
  createCarrierTariffGroup, updateCarrierTariffGroup, deleteCarrierTariffGroup,
} from '@/lib/actions/contracts';
import { usePermissions } from '@/hooks/usePermissions';

const { Title, Text } = Typography;
const fmt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY') : '—');

interface DateGroup { validFrom: string; tariffs: any[] }
interface RouteData { direction: any; dateGroups: DateGroup[] } // dateGroups[0] = актуальный

function groupByDirection(tariffs: any[]): RouteData[] {
  const byDir = new Map<string, { direction: any; byDate: Map<string, any[]> }>();
  for (const t of tariffs) {
    const rk = t.directionId || (t.originLocationId ? `${t.originLocationId}_${t.destinationLocationId || ''}` : '__no_dir__');
    if (!byDir.has(rk)) byDir.set(rk, { direction: t.direction, byDate: new Map() });
    const entry = byDir.get(rk)!;
    const dk = dayjs(t.validFrom).format('YYYY-MM-DD');
    if (!entry.byDate.has(dk)) entry.byDate.set(dk, []);
    entry.byDate.get(dk)!.push(t);
  }
  const result: RouteData[] = [];
  for (const [, { direction, byDate }] of Array.from(byDir)) {
    const sortedDates = Array.from(byDate.keys()).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    result.push({ direction, dateGroups: sortedDates.map(d => ({ validFrom: d, tariffs: byDate.get(d)! })) });
  }
  return result;
}

type TariffGroup = { direction: any; tariffs: any[] };

export default function CarrierContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = usePermissions();
  const w = can('references.write');

  const [contract, setContract] = useState<any>(null);
  const [vtList, setVtList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tariffOpen, setTariffOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TariffGroup | null>(null);
  const [notesEdit, setNotesEdit] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [priceIncludesVat, setPriceIncludesVat] = useState(false);
  const [tariffMode, setTariffMode] = useState<'trip' | 'pallet'>('trip');
  const [showHistorical, setShowHistorical] = useState(false);
  const [form] = Form.useForm();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, vt] = await Promise.all([getCarrierContractDetail(id), getVehicleTypes()]);
      setContract(c);
      setVtList([...vt].sort((a: any, b: any) => parseInt(a.code.replace('VT-', '')) - parseInt(b.code.replace('VT-', ''))));
      setNotesValue(c?.notes || '');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  const vatRate = contract?.vatRatePct ?? 0;

  const openAdd = () => {
    setEditingGroup(null);
    form.resetFields();
    form.setFieldsValue({ validFrom: dayjs() });
    setPriceIncludesVat(false);
    setTariffMode('trip');
    setTariffOpen(true);
  };

  const openEdit = (group: TariffGroup) => {
    setEditingGroup(group);
    form.resetFields();
    const isTrip = group.tariffs.some((t: any) => t.vehicleTypeCode && t.pricePerTrip != null);
    setTariffMode(isTrip ? 'trip' : 'pallet');
    const vals: any = {
      originId: group.direction?.originId ?? group.tariffs[0]?.originLocationId ?? null,
      destinationId: group.direction?.destinationId ?? group.tariffs[0]?.destinationLocationId ?? null,
      directionId: group.direction?.id ?? null,
      validFrom: dayjs(group.tariffs[0].validFrom),
    };
    if (isTrip) {
      for (const t of group.tariffs) {
        if (t.vehicleTypeCode && t.pricePerTrip != null) vals[`trip_${t.vehicleTypeCode}`] = Number(t.pricePerTrip);
      }
    } else {
      const anyPallet = group.tariffs.find((t: any) => t.pricePerPallet != null);
      if (anyPallet) vals.pricePerPallet = Number(anyPallet.pricePerPallet);
    }
    form.setFieldsValue(vals);
    setPriceIncludesVat(false);
    setTariffOpen(true);
  };

  const onTariffSubmit = async () => {
    const v = await form.validateFields();
    const tripPrices = tariffMode === 'trip'
      ? vtList
          .map(vt => ({ vehicleTypeCode: vt.code, pricePerTrip: v[`trip_${vt.code}`] }))
          .filter(tp => tp.pricePerTrip != null && tp.pricePerTrip !== '')
          .map(tp => ({ vehicleTypeCode: tp.vehicleTypeCode, pricePerTrip: Number(tp.pricePerTrip) }))
      : [];
    const payload = {
      originId: v.originId ?? null,
      destinationId: v.destinationId ?? null,
      directionId: v.directionId ?? null,
      validFrom: v.validFrom.format('YYYY-MM-DD'),
      vatRatePct: priceIncludesVat ? vatRate : 0,
      pricePerPallet: tariffMode === 'pallet' && v.pricePerPallet != null ? Number(v.pricePerPallet) : null,
      tripPrices,
    };
    try {
      if (editingGroup) {
        await updateCarrierTariffGroup(editingGroup.tariffs.map((t: any) => t.id), id, payload);
      } else {
        await createCarrierTariffGroup(id, payload);
      }
      message.success('Сохранено');
      setTariffOpen(false);
      refresh();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const onDeleteGroup = async (group: TariffGroup) => {
    try { await deleteCarrierTariffGroup(group.tariffs.map((t: any) => t.id), id); message.success('Удалено'); refresh(); }
    catch { message.error('Ошибка удаления'); }
  };

  const onSaveNotes = async () => {
    try { await updateCarrierContractNotes(id, notesValue); message.success('Сохранено'); setNotesEdit(false); refresh(); }
    catch { message.error('Ошибка сохранения'); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!contract) return <div style={{ padding: 40 }}>Договор не найден</div>;

  const routeData = groupByDirection(contract.tariffs || []);

  // Актуальные тарифы — первый dateGroup каждого направления
  const currentItems = routeData.map(rd => ({ direction: rd.direction, dg: rd.dateGroups[0] }));
  // Исторические — всё остальное
  const historicalItems = routeData.flatMap(rd =>
    rd.dateGroups.slice(1).map((dg, idx) => ({
      direction: rd.direction, dg,
      supersededByDate: rd.dateGroups[idx].validFrom,
    }))
  );

  // VT-колонки для актуальной таблицы
  const curVtCodes = new Set<string>();
  currentItems.forEach(({ dg }) => dg.tariffs.forEach((t: any) => { if (t.vehicleTypeCode) curVtCodes.add(t.vehicleTypeCode); }));
  const curVtList = vtList.filter((vt: any) => curVtCodes.has(vt.code));
  const hasTripCur = curVtList.length > 0;
  const hasPalletCur = currentItems.some(({ dg }) =>
    !dg.tariffs.some((t: any) => t.vehicleTypeCode && t.pricePerTrip != null) &&
    dg.tariffs.some((t: any) => t.pricePerPallet != null)
  );

  // VT-колонки для исторической таблицы
  const histVtCodes = new Set<string>();
  historicalItems.forEach(({ dg }) => dg.tariffs.forEach((t: any) => { if (t.vehicleTypeCode) histVtCodes.add(t.vehicleTypeCode); }));
  const histVtList = vtList.filter((vt: any) => histVtCodes.has(vt.code));
  const hasTripHist = histVtList.length > 0;
  const hasPalletHist = historicalItems.some(({ dg }) =>
    !dg.tariffs.some((t: any) => t.vehicleTypeCode && t.pricePerTrip != null) &&
    dg.tariffs.some((t: any) => t.pricePerPallet != null)
  );

  const parseTariffs = (tariffs: any[]) => {
    const vtMap: Record<string, number> = {};
    let palletPrice: number | null = null;
    let hasTripRows = false;
    for (const t of tariffs) {
      if (t.vehicleTypeCode && t.pricePerTrip != null) { vtMap[t.vehicleTypeCode] = Number(t.pricePerTrip); hasTripRows = true; }
      if (t.pricePerPallet != null) palletPrice = Number(t.pricePerPallet);
    }
    return { vtMap, palletPrice, hasTripRows };
  };

  const PriceCell = ({ val }: { val: number | undefined }) =>
    val != null
      ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.3 }}>
          <span style={{ fontFamily: 'monospace' }}>{val.toLocaleString('ru')}</span>
          <span style={{ color: '#aaa', fontSize: 10 }}>нетто</span>
        </div>
      : <span style={{ color: '#e0e0e0' }}>—</span>;

  const PalletCell = ({ val }: { val: number | null }) =>
    val != null
      ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.3 }}>
          <span style={{ fontFamily: 'monospace' }}>{val.toLocaleString('ru')} ₽</span>
          <span style={{ color: '#aaa', fontSize: 10 }}>нетто</span>
        </div>
      : <span style={{ color: '#ccc' }}>—</span>;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 16px 40px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 8 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/references/carrier-contracts')} />
        <Title level={4} style={{ margin: 0 }}>{contract.contractNumber}</Title>
        <Tag color={contract.isActive ? 'green' : 'default'}>{contract.isActive ? 'Активен' : 'Неактивен'}</Tag>
        <Tag color="orange">НДС {contract.vatRatePct}%</Tag>
      </div>

      {/* Contract info */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: 20, marginBottom: 16 }}>
        <Descriptions column={3} size="small">
          <Descriptions.Item label="Перевозчик">{contract.carrier?.name || '—'}</Descriptions.Item>
          <Descriptions.Item label="Ставка НДС">{contract.vatRatePct}%</Descriptions.Item>
          <Descriptions.Item label="Условия оплаты">{contract.paymentTerms || '—'}</Descriptions.Item>
          <Descriptions.Item label="Действует с">{fmt(contract.validFrom)}</Descriptions.Item>
          <Descriptions.Item label="Действует по">{fmt(contract.validTo)}</Descriptions.Item>
        </Descriptions>
      </div>

      {/* Tariffs */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #f0f0f0' }}>
          <Text strong style={{ fontSize: 15 }}>Тарифы по направлениям</Text>
          {w && <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Добавить тариф</Button>}
        </div>
        <div style={{ padding: 20 }}>
          {currentItems.length === 0 && <Text type="secondary">Тарифы не добавлены</Text>}

          {/* Актуальная таблица */}
          {currentItems.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th rowSpan={hasTripCur ? 2 : 1} style={{ ...thDate }}>Дата с</th>
                  <th rowSpan={hasTripCur ? 2 : 1} style={thL}>Откуда</th>
                  <th rowSpan={hasTripCur ? 2 : 1} style={thL}>Куда</th>
                  <th rowSpan={hasTripCur ? 2 : 1} style={thL}>Направление</th>
                  {hasPalletCur && <th rowSpan={hasTripCur ? 2 : 1} style={th}>За паллет</th>}
                  {hasTripCur && <th colSpan={curVtList.length} style={thVtGroup}>За рейс по типу ТС (нетто, ₽)</th>}
                  {w && <th rowSpan={hasTripCur ? 2 : 1} style={{ ...th, width: 70 }}>Действия</th>}
                </tr>
                {hasTripCur && (
                  <tr>{curVtList.map((vt: any) => <th key={vt.code} style={thVt}>{vt.code}</th>)}</tr>
                )}
              </thead>
              <tbody>
                {currentItems.map(({ direction, dg }, ri) => {
                  const { vtMap, palletPrice, hasTripRows } = parseTariffs(dg.tariffs);
                  return (
                    <tr key={ri} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={tdDate}>
                        <Tag color="blue" style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>{fmt(dg.validFrom)}</Tag>
                      </td>
                      <td style={tdL}>{direction?.origin?.name || dg.tariffs[0]?.originLocation?.name || '—'}</td>
                      <td style={tdL}>{direction?.destination?.name || dg.tariffs[0]?.destinationLocation?.name || '—'}</td>
                      <td style={tdL}>{direction?.name || direction?.code || '—'}</td>
                      {hasPalletCur && <td style={td}>{!hasTripRows ? <PalletCell val={palletPrice} /> : <span style={{ color: '#e0e0e0' }}>—</span>}</td>}
                      {curVtList.map((vt: any) => <td key={vt.code} style={td}><PriceCell val={vtMap[vt.code]} /></td>)}
                      {w && (
                        <td style={td}>
                          <Space size={0}>
                            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit({ direction, tariffs: dg.tariffs })} />
                            <Popconfirm title="Удалить тарифы направления?" onConfirm={() => onDeleteGroup({ direction, tariffs: dg.tariffs })}>
                              <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                            </Popconfirm>
                          </Space>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* История */}
          {historicalItems.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ borderTop: '1px dashed #e8e8e8', marginBottom: 12 }} />
              <Button
                type="text" size="small" icon={<HistoryOutlined />}
                style={{ color: '#999', fontSize: 12, padding: '0 4px' }}
                onClick={() => setShowHistorical(v => !v)}
              >
                {showHistorical ? 'Скрыть историю тарифов' : `Показать историю тарифов (${historicalItems.length})`}
              </Button>

              {showHistorical && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 10, opacity: 0.75 }}>
                  <thead>
                    <tr>
                      <th rowSpan={hasTripHist ? 2 : 1} style={thDate}>Дата с</th>
                      <th rowSpan={hasTripHist ? 2 : 1} style={thDate}>Дата по</th>
                      <th rowSpan={hasTripHist ? 2 : 1} style={thL}>Откуда</th>
                      <th rowSpan={hasTripHist ? 2 : 1} style={thL}>Куда</th>
                      <th rowSpan={hasTripHist ? 2 : 1} style={thL}>Направление</th>
                      {hasPalletHist && <th rowSpan={hasTripHist ? 2 : 1} style={th}>За паллет</th>}
                      {hasTripHist && <th colSpan={histVtList.length} style={{ ...th, color: '#999' }}>За рейс по типу ТС (нетто, ₽)</th>}
                      {w && <th rowSpan={hasTripHist ? 2 : 1} style={{ ...th, width: 50 }}></th>}
                    </tr>
                    {hasTripHist && (
                      <tr>{histVtList.map((vt: any) => <th key={vt.code} style={{ ...th, color: '#999' }}>{vt.code}</th>)}</tr>
                    )}
                  </thead>
                  <tbody>
                    {historicalItems.map(({ direction, dg, supersededByDate }, ri) => {
                      const { vtMap, palletPrice, hasTripRows } = parseTariffs(dg.tariffs);
                      const validTo = dayjs(supersededByDate).subtract(1, 'day').format('DD.MM.YYYY');
                      return (
                        <tr key={ri} style={{ borderBottom: '1px solid #f5f5f5', background: '#fafafa' }}>
                          <td style={tdDate}><span style={{ color: '#bbb', fontSize: 11 }}>{fmt(dg.validFrom)}</span></td>
                          <td style={tdDate}><span style={{ color: '#bbb', fontSize: 11 }}>{validTo}</span></td>
                          <td style={{ ...tdL, color: '#999' }}>{direction?.origin?.name || dg.tariffs[0]?.originLocation?.name || '—'}</td>
                          <td style={{ ...tdL, color: '#999' }}>{direction?.destination?.name || dg.tariffs[0]?.destinationLocation?.name || '—'}</td>
                          <td style={{ ...tdL, color: '#999' }}>{direction?.name || direction?.code || '—'}</td>
                          {hasPalletHist && <td style={td}>{!hasTripRows ? <PalletCell val={palletPrice} /> : <span style={{ color: '#e0e0e0' }}>—</span>}</td>}
                          {histVtList.map((vt: any) => <td key={vt.code} style={td}><PriceCell val={vtMap[vt.code]} /></td>)}
                          {w && (
                            <td style={td}>
                              <Popconfirm title="Удалить старый тариф?" onConfirm={() => onDeleteGroup({ direction, tariffs: dg.tariffs })}>
                                <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #f0f0f0' }}>
          <Text strong style={{ fontSize: 15 }}>Заметки</Text>
          {notesEdit
            ? <Space>
                <Button size="small" type="primary" onClick={onSaveNotes}>Сохранить</Button>
                <Button size="small" onClick={() => { setNotesEdit(false); setNotesValue(contract.notes || ''); }}>Отмена</Button>
              </Space>
            : w && <Button size="small" icon={<EditOutlined />} onClick={() => setNotesEdit(true)}>Редактировать</Button>}
        </div>
        <div style={{ padding: 20 }}>
          {notesEdit
            ? <Input.TextArea value={notesValue} onChange={e => setNotesValue(e.target.value)} rows={4} autoFocus />
            : <Text style={{ whiteSpace: 'pre-wrap', color: contract.notes ? '#333' : '#bbb' }}>{contract.notes || 'Нет заметок'}</Text>}
        </div>
      </div>

      {/* Tariff modal */}
      <Modal
        open={tariffOpen}
        title={editingGroup ? 'Редактировать тариф направления' : 'Новый тариф'}
        onCancel={() => setTariffOpen(false)}
        onOk={onTariffSubmit}
        okText="Сохранить"
        cancelText="Отмена"
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" size="small">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="originId" label="Откуда">
              <LocationSelect style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="destinationId" label="Куда">
              <LocationSelect style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="directionId" label="Направление (опц.)">
            <DirectionSelect style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="validFrom" label="Действует с" rules={[{ required: true }]}>
            <DatePicker format="DD.MM.YYYY" style={{ width: 200 }} />
          </Form.Item>
          <div style={{ marginBottom: 16 }}>
            <Radio.Group value={tariffMode} onChange={e => setTariffMode(e.target.value)} buttonStyle="solid" size="small">
              <Radio.Button value="trip">За рейс (по типу ТС)</Radio.Button>
              <Radio.Button value="pallet">За паллет</Radio.Button>
            </Radio.Group>
          </div>
          {vatRate > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '8px 12px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' }}>
              <Switch checked={priceIncludesVat} onChange={setPriceIncludesVat} size="small" />
              <span style={{ fontSize: 13 }}>
                {priceIncludesVat
                  ? <><b>Ввожу с НДС {vatRate}%</b> — система сохранит нетто (÷ {(1 + vatRate / 100).toFixed(2)})</>
                  : <>Ввожу без НДС</>}
              </span>
            </div>
          )}
          {tariffMode === 'pallet' && (
            <Form.Item name="pricePerPallet" label="Цена за паллет, ₽" rules={[{ required: true }]}>
              <InputNumber style={{ width: 180 }} precision={2} step={100} min={0} placeholder="0.00" />
            </Form.Item>
          )}
          {tariffMode === 'trip' && (
            <>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                Цена за рейс по типу ТС (оставьте пустым если не используется):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {vtList.map(vt => (
                  <Form.Item key={vt.code} name={`trip_${vt.code}`} label={<span style={{ fontSize: 11 }}>{vt.code}</span>} style={{ marginBottom: 8 }}>
                    <InputNumber style={{ width: 100 }} precision={2} step={1000} min={0} placeholder="—" />
                  </Form.Item>
                ))}
              </div>
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
}

const th: React.CSSProperties = { border: '1px solid #e8e8e8', padding: '7px 10px', fontWeight: 600, color: '#555', textAlign: 'center', background: '#fafafa', whiteSpace: 'nowrap' };
const thL: React.CSSProperties = { ...th, textAlign: 'left' };
const thDate: React.CSSProperties = { ...th, width: 95, textAlign: 'center' };
const thVtGroup: React.CSSProperties = { ...th, background: '#fffbe6', color: '#ad6800', borderColor: '#ffd591' };
const thVt: React.CSSProperties = { ...th, background: '#fffbe6', color: '#ad6800', borderColor: '#ffd591', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { border: '1px solid #f0f0f0', padding: '6px 10px', textAlign: 'center', verticalAlign: 'middle' };
const tdL: React.CSSProperties = { ...td, textAlign: 'left', fontWeight: 500 };
const tdDate: React.CSSProperties = { ...td, width: 95, textAlign: 'center' };
