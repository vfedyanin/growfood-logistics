'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Button, Form, Input, DatePicker, Select, Space, Popconfirm, Tag, message,
  Descriptions, Typography, Spin, InputNumber, Switch, Modal,
} from 'antd';
import { ArrowLeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined, HistoryOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { LocationSelect, CustomerSelect } from '@/components/selects/EntitySelects';
import { getVehicleTypes } from '@/lib/actions/references';
import {
  getCustomerContractDetail, updateCustomerContractNotes,
  createContractTariff, updateContractTariff, deleteContractTariff,
  addContractMember, removeContractMember,
} from '@/lib/actions/contracts';

const { Title, Text } = Typography;

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  LAAS_SERVICE: 'LaaS-услуга',
  RETAIL_SUPPLY: 'Поставка в сеть',
  INTERNAL_AGREEMENT: 'Внутреннее соглашение',
};

const fmt = (d: any) => (d ? dayjs(d).format('DD.MM.YYYY') : '—');

interface TariffEntry { validFrom: string; tariff: any }
interface RouteData { direction: any; entries: TariffEntry[] }

function groupByDirection(tariffs: any[]): RouteData[] {
  const byDir = new Map<string, { direction: any; byDate: Map<string, any> }>();
  for (const t of tariffs) {
    const rk = t.directionId || '__no_dir__';
    if (!byDir.has(rk)) byDir.set(rk, { direction: t.direction, byDate: new Map() });
    const entry = byDir.get(rk)!;
    const dk = dayjs(t.validFrom).format('YYYY-MM-DD');
    if (!entry.byDate.has(dk)) entry.byDate.set(dk, t);
  }
  const result: RouteData[] = [];
  for (const [, { direction, byDate }] of byDir) {
    const sortedDates = [...byDate.keys()].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    result.push({ direction, entries: sortedDates.map(d => ({ validFrom: d, tariff: byDate.get(d) })) });
  }
  return result;
}

export default function CustomerContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [contract, setContract] = useState<any>(null);
  const [vtList, setVtList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tariffOpen, setTariffOpen] = useState(false);
  const [editingTariff, setEditingTariff] = useState<any>(null);
  const [notesEdit, setNotesEdit] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [newMemberId, setNewMemberId] = useState<string | undefined>(undefined);
  const [priceIncludesVat, setPriceIncludesVat] = useState(false);
  const [tariffType, setTariffType] = useState<'PER_PALLET' | 'PER_TRIP'>('PER_PALLET');
  const [showHistory, setShowHistory] = useState(false);
  const [form] = Form.useForm();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, vt] = await Promise.all([getCustomerContractDetail(id), getVehicleTypes()]);
      setContract(c);
      setVtList([...vt].sort((a: any, b: any) => parseInt(a.code.replace('VT-', '')) - parseInt(b.code.replace('VT-', ''))));
      setNotesValue(c?.notes || '');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  const vatRate = contract?.vatRatePct ?? 0;

  const openAdd = () => {
    setEditingTariff(null);
    form.resetFields();
    form.setFieldsValue({ validFrom: dayjs(), tariffType: 'PER_PALLET' });
    setTariffType('PER_PALLET');
    setPriceIncludesVat(false);
    setTariffOpen(true);
  };

  const openEdit = (t: any) => {
    setEditingTariff(t);
    form.resetFields();
    const tierMap: any = {};
    t.tiers?.forEach((tier: any) => { tierMap[`tier_${tier.vehicleTypeCode}`] = Number(tier.price); });
    form.setFieldsValue({
      originId: t.direction?.originId ?? null,
      destinationId: t.direction?.destinationId ?? null,
      tariffType: t.tariffType,
      validFrom: dayjs(t.validFrom),
      pricePerPallet: t.pricePerPallet != null ? Number(t.pricePerPallet) : undefined,
      ...tierMap,
    });
    setTariffType(t.tariffType);
    setPriceIncludesVat(false);
    setTariffOpen(true);
  };

  const onTariffSubmit = async () => {
    const v = await form.validateFields();
    const tiers = vtList
      .map(vt => ({ vehicleTypeCode: vt.code, price: v[`tier_${vt.code}`] }))
      .filter(t => t.price != null && t.price !== '' && !isNaN(Number(t.price)))
      .map(t => ({ ...t, price: Number(t.price) }));

    const payload = {
      originId: v.originId ?? null,
      destinationId: v.destinationId ?? null,
      tariffType: v.tariffType,
      validFrom: v.validFrom.format('YYYY-MM-DD'),
      pricePerPallet: v.tariffType === 'PER_PALLET' ? v.pricePerPallet : null,
      vatRatePct: priceIncludesVat ? vatRate : 0,
      tiers: v.tariffType === 'PER_TRIP' ? tiers : [],
    };

    try {
      if (editingTariff) await updateContractTariff(editingTariff.id, id, payload);
      else await createContractTariff(id, payload);
      message.success('Сохранено');
      setTariffOpen(false);
      refresh();
    } catch (e: any) { message.error(e?.message || 'Ошибка сохранения'); }
  };

  const onDeleteTariff = async (tariffId: string) => {
    try { await deleteContractTariff(tariffId, id); message.success('Удалено'); refresh(); }
    catch { message.error('Ошибка удаления'); }
  };

  const onAddMember = async () => {
    if (!newMemberId) return;
    try { await addContractMember(id, newMemberId); message.success('Юрлицо добавлено'); setNewMemberId(undefined); refresh(); }
    catch { message.error('Ошибка добавления'); }
  };
  const onRemoveMember = async (customerId: string) => {
    try { await removeContractMember(id, customerId); message.success('Удалено из группы'); refresh(); }
    catch { message.error('Ошибка удаления'); }
  };

  const onSaveNotes = async () => {
    try { await updateCustomerContractNotes(id, notesValue); message.success('Сохранено'); setNotesEdit(false); refresh(); }
    catch { message.error('Ошибка сохранения'); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!contract) return <div style={{ padding: 40 }}>Договор не найден</div>;

  const routeData = groupByDirection(contract.tariffs || []);
  const currentItems = routeData.map(rd => ({ entry: rd.entries[0] }));
  const historicalItems = routeData.flatMap(rd =>
    rd.entries.slice(1).map((entry, idx) => ({
      entry,
      supersededByDate: rd.entries[idx].validFrom,
    }))
  );

  const allVtCodes = new Set<string>();
  (contract.tariffs || []).forEach((t: any) =>
    (t.tiers || []).forEach((tier: any) => allVtCodes.add(tier.vehicleTypeCode))
  );
  const displayVtList = vtList.filter((vt: any) => allVtCodes.has(vt.code));
  const hasTripTariffs = displayVtList.length > 0;

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto', padding: '0 16px 40px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 8 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/references/customer-contracts')} />
        <Title level={4} style={{ margin: 0 }}>{contract.contractNumber}</Title>
        <Tag color={contract.isActive ? 'green' : 'default'}>{contract.isActive ? 'Активен' : 'Неактивен'}</Tag>
        <Tag color="blue">{CONTRACT_TYPE_LABELS[contract.contractType] || contract.contractType}</Tag>
        <Tag color="orange">НДС {contract.vatRatePct}%</Tag>
      </div>

      {/* Contract info */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: 20, marginBottom: 16 }}>
        <Descriptions column={3} size="small">
          <Descriptions.Item label="Клиент">{contract.customer?.name || '—'}</Descriptions.Item>
          <Descriptions.Item label="Тип договора">{CONTRACT_TYPE_LABELS[contract.contractType] || contract.contractType}</Descriptions.Item>
          <Descriptions.Item label="Ставка НДС">{contract.vatRatePct}%</Descriptions.Item>
          <Descriptions.Item label="Действует с">{fmt(contract.validFrom)}</Descriptions.Item>
          <Descriptions.Item label="Действует по">{fmt(contract.validTo)}</Descriptions.Item>
          <Descriptions.Item label="Условия оплаты">{contract.paymentTerms || '—'}</Descriptions.Item>
        </Descriptions>
      </div>

      {/* Tariffs */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #f0f0f0' }}>
          <Text strong style={{ fontSize: 15 }}>Тарифы по направлениям</Text>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Добавить тариф</Button>
        </div>
        <div style={{ padding: 20 }}>
          {currentItems.length === 0 && <Text type="secondary">Тарифы не добавлены</Text>}
          {currentItems.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th rowSpan={hasTripTariffs ? 2 : 1} style={thL}>Дата с</th>
                  <th rowSpan={hasTripTariffs ? 2 : 1} style={thL}>Откуда</th>
                  <th rowSpan={hasTripTariffs ? 2 : 1} style={thL}>Куда</th>
                  <th rowSpan={hasTripTariffs ? 2 : 1} style={th}>Тип</th>
                  <th rowSpan={hasTripTariffs ? 2 : 1} style={th}>По паллетам</th>
                  {hasTripTariffs && <th colSpan={displayVtList.length} style={{ ...th, background: '#fffbe6', color: '#ad6800', borderColor: '#ffd591' }}>За рейс по типу ТС (нетто, ₽)</th>}
                  <th rowSpan={hasTripTariffs ? 2 : 1} style={{ ...th, width: 70 }}>Действия</th>
                </tr>
                {hasTripTariffs && (
                  <tr>
                    {displayVtList.map((vt: any) => (
                      <th key={vt.code} style={{ ...th, background: '#fffbe6', color: '#ad6800', borderColor: '#ffd591', whiteSpace: 'nowrap' }}>{vt.code}</th>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {currentItems.map(({ entry }) => {
                  const t = entry.tariff;
                  const tierMap: Record<string, number> = {};
                  t.tiers?.forEach((tier: any) => { tierMap[tier.vehicleTypeCode] = Number(tier.price); });
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={tdL}><Tag color="blue" style={{ fontSize: 11 }}>{dayjs(entry.validFrom).format('DD.MM.YYYY')}</Tag></td>
                      <td style={tdL}>{t.direction?.origin?.name || '—'}</td>
                      <td style={tdL}>{t.direction?.destination?.name || '—'}</td>
                      <td style={td}>
                        <Tag color={t.tariffType === 'PER_PALLET' ? 'purple' : 'blue'} style={{ fontSize: 11 }}>
                          {t.tariffType === 'PER_PALLET' ? 'паллет' : 'рейс'}
                        </Tag>
                      </td>
                      <td style={td}>
                        {t.pricePerPallet != null
                          ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}><span style={{ fontFamily: 'monospace' }}>{Number(t.pricePerPallet).toLocaleString('ru')} ₽</span><span style={{ color: '#aaa', fontSize: 10 }}>нетто</span></div>
                          : <span style={{ color: '#ccc' }}>—</span>}
                      </td>
                      {displayVtList.map((vt: any) => (
                        <td key={vt.code} style={td}>
                          {tierMap[vt.code] != null
                            ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2 }}><span style={{ fontFamily: 'monospace' }}>{tierMap[vt.code].toLocaleString('ru')}</span><span style={{ color: '#aaa', fontSize: 10 }}>нетто</span></div>
                            : <span style={{ color: '#e0e0e0' }}>—</span>}
                        </td>
                      ))}
                      <td style={td}>
                        <Space size={0}>
                          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(t)} />
                          <Popconfirm title="Удалить тариф?" onConfirm={() => onDeleteTariff(t.id)}>
                            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </Space>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {historicalItems.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Button
                type="link"
                size="small"
                icon={<HistoryOutlined />}
                onClick={() => setShowHistory(v => !v)}
                style={{ paddingLeft: 0, color: '#888' }}
              >
                {showHistory ? 'Скрыть историю тарифов' : `Показать историю тарифов (${historicalItems.length})`}
              </Button>
              {showHistory && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th rowSpan={hasTripTariffs ? 2 : 1} style={{ ...thL, color: '#531dab' }}>Дата с</th>
                      <th rowSpan={hasTripTariffs ? 2 : 1} style={{ ...thL, color: '#531dab' }}>Дата по</th>
                      <th rowSpan={hasTripTariffs ? 2 : 1} style={thL}>Откуда</th>
                      <th rowSpan={hasTripTariffs ? 2 : 1} style={thL}>Куда</th>
                      <th rowSpan={hasTripTariffs ? 2 : 1} style={th}>Тип</th>
                      <th rowSpan={hasTripTariffs ? 2 : 1} style={th}>По паллетам</th>
                      {hasTripTariffs && <th colSpan={displayVtList.length} style={{ ...th, background: '#fffbe6', color: '#ad6800', borderColor: '#ffd591' }}>За рейс по типу ТС (нетто, ₽)</th>}
                    </tr>
                    {hasTripTariffs && (
                      <tr>
                        {displayVtList.map((vt: any) => (
                          <th key={vt.code} style={{ ...th, background: '#fffbe6', color: '#ad6800', borderColor: '#ffd591', whiteSpace: 'nowrap' }}>{vt.code}</th>
                        ))}
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {historicalItems.map(({ entry, supersededByDate }) => {
                      const t = entry.tariff;
                      const validTo = dayjs(supersededByDate).subtract(1, 'day').format('DD.MM.YYYY');
                      const tierMap: Record<string, number> = {};
                      t.tiers?.forEach((tier: any) => { tierMap[tier.vehicleTypeCode] = Number(tier.price); });
                      return (
                        <tr key={t.id + entry.validFrom} style={{ borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
                          <td style={{ ...tdL, color: '#888' }}>{dayjs(entry.validFrom).format('DD.MM.YYYY')}</td>
                          <td style={{ ...tdL, color: '#888' }}>{validTo}</td>
                          <td style={{ ...tdL, color: '#888' }}>{t.direction?.origin?.name || '—'}</td>
                          <td style={{ ...tdL, color: '#888' }}>{t.direction?.destination?.name || '—'}</td>
                          <td style={td}>
                            <Tag color={t.tariffType === 'PER_PALLET' ? 'purple' : 'blue'} style={{ fontSize: 11, opacity: 0.6 }}>
                              {t.tariffType === 'PER_PALLET' ? 'паллет' : 'рейс'}
                            </Tag>
                          </td>
                          <td style={td}>
                            {t.pricePerPallet != null
                              ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}><span style={{ fontFamily: 'monospace', color: '#888' }}>{Number(t.pricePerPallet).toLocaleString('ru')} ₽</span><span style={{ color: '#aaa', fontSize: 10 }}>нетто</span></div>
                              : <span style={{ color: '#ccc' }}>—</span>}
                          </td>
                          {displayVtList.map((vt: any) => (
                            <td key={vt.code} style={td}>
                              {tierMap[vt.code] != null
                                ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2 }}><span style={{ fontFamily: 'monospace', color: '#888' }}>{tierMap[vt.code].toLocaleString('ru')}</span><span style={{ color: '#aaa', fontSize: 10 }}>нетто</span></div>
                                : <span style={{ color: '#e0e0e0' }}>—</span>}
                            </td>
                          ))}
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

      {/* Group members */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Text strong style={{ fontSize: 15 }}>Юридические лица группы</Text>
            {contract.members?.length > 0 && <Tag color="orange">Групповой договор</Tag>}
          </div>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Основное юрлицо</div>
            <Tag style={{ fontSize: 13, padding: '3px 10px' }}>{contract.customer?.name}</Tag>
          </div>
          {contract.members?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Дополнительные участники</div>
              <Space wrap>
                {contract.members.map((m: any) => (
                  <Tag key={m.customerId} closable onClose={() => onRemoveMember(m.customerId)}
                    style={{ fontSize: 13, padding: '3px 10px' }}>
                    {m.customer?.name}
                  </Tag>
                ))}
              </Space>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <CustomerSelect value={newMemberId} onChange={(v: any) => setNewMemberId(v)}
              style={{ width: 280 }} placeholder="Добавить юрлицо в группу..." />
            <Button type="dashed" icon={<PlusOutlined />} onClick={onAddMember} disabled={!newMemberId}>
              Добавить
            </Button>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #f0f0f0' }}>
          <Text strong style={{ fontSize: 15 }}>Заметки</Text>
          {notesEdit
            ? <Space><Button size="small" type="primary" onClick={onSaveNotes}>Сохранить</Button><Button size="small" onClick={() => { setNotesEdit(false); setNotesValue(contract.notes || ''); }}>Отмена</Button></Space>
            : <Button size="small" icon={<EditOutlined />} onClick={() => setNotesEdit(true)}>Редактировать</Button>}
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
        title={editingTariff ? 'Редактировать тариф' : 'Новый тариф'}
        onCancel={() => setTariffOpen(false)}
        onOk={onTariffSubmit}
        okText="Сохранить"
        cancelText="Отмена"
        width={680}
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="tariffType" label="Тип тарифа" rules={[{ required: true }]}>
              <Select onChange={(v: any) => setTariffType(v)} options={[
                { value: 'PER_PALLET', label: 'За паллет' },
                { value: 'PER_TRIP', label: 'За рейс (по типу ТС)' },
              ]} />
            </Form.Item>
            <Form.Item name="validFrom" label="Действует с" rules={[{ required: true }]}>
              <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
            </Form.Item>
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

          {tariffType === 'PER_PALLET' && (
            <Form.Item name="pricePerPallet" label="Цена за паллет, ₽" rules={[{ required: true }]}>
              <InputNumber style={{ width: 200 }} precision={2} step={100} min={0} />
            </Form.Item>
          )}

          {tariffType === 'PER_TRIP' && (
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Цена за рейс по типу ТС (оставьте пустым если не используется):</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {vtList.map(vt => (
                  <Form.Item key={vt.code} name={`tier_${vt.code}`} label={<span style={{ fontSize: 11 }}>{vt.code}</span>} style={{ marginBottom: 8 }}>
                    <InputNumber style={{ width: 100 }} precision={2} step={1000} min={0} placeholder="—" />
                  </Form.Item>
                ))}
              </div>
            </div>
          )}
        </Form>
      </Modal>
    </div>
  );
}

const th: React.CSSProperties = { border: '1px solid #e8e8e8', padding: '7px 10px', fontWeight: 600, color: '#555', textAlign: 'center', background: '#fafafa', whiteSpace: 'nowrap' };
const thL: React.CSSProperties = { ...th, textAlign: 'left' };
const td: React.CSSProperties = { border: '1px solid #f0f0f0', padding: '6px 10px', textAlign: 'center', verticalAlign: 'middle' };
const tdL: React.CSSProperties = { ...td, textAlign: 'left', fontWeight: 500 };
