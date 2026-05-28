'use client';

import React, { useState } from 'react';
import { Button, Modal, message, Space } from 'antd';
import { UploadOutlined, DownloadOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { exportRef, dryRunImportRef, commitImportRef } from '@/lib/actions/references-io';

type Props = {
  resource: string;
  onChanged?: () => void;
  canWrite?: boolean;
};

export default function ImportExportButtons({ resource, onChanged, canWrite }: Props) {
  const [busy, setBusy] = useState<null | 'import' | 'export'>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmData, setConfirmData] = useState<{ toDelete: { identity: string; displayName: string }[]; rows: any[]; rowsInFile: number } | null>(null);

  const onExport = async () => {
    setBusy('export');
    try {
      const { rows, fileBaseName, label } = await exportRef(resource);
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, label.slice(0, 31));
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `${fileBaseName}-${stamp}.xlsx`);
      message.success(`Экспортировано: ${rows.length} строк`);
    } catch (e: any) {
      message.error(e?.message || 'Ошибка экспорта');
    } finally {
      setBusy(null);
    }
  };

  const readFile = (file: File): Promise<any[]> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
        resolve(rows as any[]);
      } catch (err: any) { reject(new Error(err?.message || 'Не удалось разобрать Excel')); }
    };
    reader.readAsArrayBuffer(file);
  });

  const runDryRun = async (rows: any[]) => {
    const res = await dryRunImportRef(resource, rows);
    if (!res.ok) {
      Modal.error({
        title: 'Ошибки в файле — импорт не выполнен',
        width: 700,
        content: <div style={{ maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>{res.errors.join('\n')}</div>,
      });
      return;
    }
    if (res.toDelete.length > 0) {
      setConfirmData({ toDelete: res.toDelete, rows, rowsInFile: res.rowsInFile });
      setConfirmOpen(true);
    } else {
      await runCommit(rows);
    }
  };

  const runCommit = async (rows: any[]) => {
    setBusy('import');
    try {
      const r = await commitImportRef(resource, rows);
      const parts = [`загружено/обновлено: ${r.upserted}`];
      if (r.deleted) parts.push(`удалено: ${r.deleted}`);
      if (r.softDeleted) parts.push(`деактивировано: ${r.softDeleted}`);
      if (r.skipped) parts.push(`пропущено: ${r.skipped}`);
      message.success('Импорт завершён — ' + parts.join(', '));
      onChanged?.();
    } catch (e: any) {
      Modal.error({ title: 'Ошибка импорта', width: 700, content: <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{e?.message || String(e)}</pre> });
    } finally {
      setBusy(null);
    }
  };

  const onImportClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      setBusy('import');
      try {
        const rows = await readFile(file);
        if (!Array.isArray(rows) || rows.length === 0) { message.warning('В файле нет строк'); return; }
        await runDryRun(rows);
      } catch (e: any) {
        message.error(e?.message || 'Ошибка чтения файла');
      } finally {
        setBusy(null);
      }
    };
    input.click();
  };

  const confirmDelete = async () => {
    if (!confirmData) return;
    setConfirmOpen(false);
    await runCommit(confirmData.rows);
    setConfirmData(null);
  };

  return (
    <>
      <Space>
        <Button icon={<DownloadOutlined />} onClick={onExport} loading={busy === 'export'} disabled={busy !== null}>
          Экспортировать
        </Button>
        {canWrite !== false && (
          <Button icon={<UploadOutlined />} onClick={onImportClick} loading={busy === 'import'} disabled={busy !== null}>
            Импортировать
          </Button>
        )}
      </Space>

      <Modal
        open={confirmOpen}
        title="Будут стёрты записи"
        onOk={confirmDelete}
        onCancel={() => { setConfirmOpen(false); setConfirmData(null); }}
        okText="Продолжить импорт"
        okButtonProps={{ danger: true }}
        cancelText="Отмена"
        width={640}
      >
        {confirmData && (
          <>
            <p>В загружаемом файле <b>отсутствуют {confirmData.toDelete.length}</b> {confirmData.toDelete.length === 1 ? 'запись' : 'записей'}, которые есть в БД. Они будут <b>удалены</b> (или <b>деактивированы</b>, если есть ссылки из рейсов/заявок).</p>
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 6, padding: 8, fontSize: 12, background: '#fafafa' }}>
              {confirmData.toDelete.slice(0, 200).map((r, idx) => (
                <div key={idx}>• {r.displayName} <span style={{ color: '#999' }}>({r.identity})</span></div>
              ))}
              {confirmData.toDelete.length > 200 && <div style={{ color: '#999', marginTop: 6 }}>…и ещё {confirmData.toDelete.length - 200}</div>}
            </div>
            <p style={{ marginTop: 8, color: '#999' }}>Всего строк в файле: {confirmData.rowsInFile} (будут upsert).</p>
          </>
        )}
      </Modal>
    </>
  );
}
