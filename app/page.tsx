"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Papa from "papaparse";
import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

type CsvRow = string[];

type ColumnConfig = {
  id: string;
  originalName: string;
  outputName: string;
  sourceIndex: number;
};

type ParseState = {
  fileName: string;
  columns: ColumnConfig[];
  rows: CsvRow[];
};

type DuplicateHeaderWarning = {
  message: string;
  pendingState: ParseState;
};

const sampleLimit = 5;
const csvExtensionPattern = /\.csv$/i;
const sampleCsvContent = "商品コード,商品名,在庫数\r\nA001,ペン,5\r\nA002,ノート,10\r\n";

export default function Home() {
  const [parseState, setParseState] = useState<ParseState | null>(null);
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateHeaderWarning | null>(null);
  const [deletedColumns, setDeletedColumns] = useState<ColumnConfig[]>([]);
  const [successMessage, setSuccessMessage] = useState("");
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const hasCsv = parseState !== null;

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  const previewRows = useMemo(() => {
    if (!parseState) {
      return [];
    }

    return parseState.rows.slice(0, sampleLimit).map((row) =>
      parseState.columns.map((column) => row[column.sourceIndex] ?? ""),
    );
  }, [parseState]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = event.target.files ?? [];
    if (file) {
      readCsv(file);
      event.target.value = "";
    }
  };

  const readCsv = (file: File) => {
    setError("");
    setDuplicateWarning(null);
    setDeletedColumns([]);

    if (!isCsvFile(file)) {
      setParseState(null);
      setDeletedColumns([]);
      setError(`「${file.name}」はCSVファイルではありません。.csv形式のファイルを選択してください。`);
      return;
    }

    Papa.parse<CsvRow>(file, {
      complete: (result) => {
        const data = toCellRows(result.data);

        if (!data.some(hasRowContent)) {
          setError("CSVにデータがありません");
          setParseState(null);
          setDeletedColumns([]);
          return;
        }

        const [headerRow, ...remainingRows] = data;

        if (!headerRow || !hasRowContent(headerRow)) {
          setError("ヘッダー行が存在しません");
          setParseState(null);
          setDeletedColumns([]);
          return;
        }

        const duplicatedHeaders = findDuplicatedHeaders(headerRow);
        const bodyRows = remainingRows.filter(hasRowContent);
        const nextParseState = {
          fileName: file.name,
          columns: createColumns(headerRow),
          rows: bodyRows,
        };

        if (duplicatedHeaders.length > 0) {
          setDuplicateWarning({
            message: `重複しているヘッダー名があります。${duplicatedHeaders.join("、")} が複数存在します。このまま読み込むこともできます。`,
            pendingState: nextParseState,
          });
          return;
        }

        setParseState(nextParseState);
      },
      error: () => {
        setError("CSVを読み込めませんでした。文字コードやファイル形式を確認してください。");
        setDuplicateWarning(null);
        setParseState(null);
        setDeletedColumns([]);
      },
    });
  };

  const cancelDuplicateCsv = () => {
    setDuplicateWarning(null);
    setDeletedColumns([]);
    setParseState(null);
  };

  const allowDuplicateCsv = () => {
    if (!duplicateWarning) {
      return;
    }

    setParseState(duplicateWarning.pendingState);
    setDuplicateWarning(null);
    setDeletedColumns([]);
    setError("");
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!parseState || !over || active.id === over.id) {
      return;
    }

    const oldIndex = parseState.columns.findIndex((column) => column.id === active.id);
    const newIndex = parseState.columns.findIndex((column) => column.id === over.id);

    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    setParseState({
      ...parseState,
      columns: arrayMove(parseState.columns, oldIndex, newIndex),
    });
  };

  const updateColumnName = (columnId: string, outputName: string) => {
    if (!parseState) {
      return;
    }

    setParseState({
      ...parseState,
      columns: parseState.columns.map((column) =>
        column.id === columnId ? { ...column, outputName } : column,
      ),
    });
  };

  const resetColumns = () => {
    if (!parseState) {
      return;
    }

    setParseState({
      ...parseState,
      columns: [...parseState.columns]
        .sort((a, b) => a.sourceIndex - b.sourceIndex)
        .map((column) => ({ ...column, outputName: column.originalName })),
    });
  };

  const addColumn = () => {
    if (!parseState) {
      return;
    }

    const nextColumn = createAddedColumn([...parseState.columns, ...deletedColumns]);

    setParseState({
      ...parseState,
      columns: [...parseState.columns, nextColumn],
    });
  };

  const deleteColumn = (columnId: string) => {
    if (!parseState) {
      return;
    }

    const deletedColumn = parseState.columns.find((column) => column.id === columnId);

    if (!deletedColumn) {
      return;
    }

    setParseState({
      ...parseState,
      columns: parseState.columns.filter((column) => column.id !== columnId),
    });
    setDeletedColumns((currentColumns) => [...currentColumns, deletedColumn]);
  };

  const restoreDeletedColumn = (columnId: string) => {
    if (!parseState) {
      return;
    }

    const restoredColumn = deletedColumns.find((column) => column.id === columnId);

    if (!restoredColumn) {
      return;
    }

    setParseState({
      ...parseState,
      columns: [...parseState.columns, restoredColumn],
    });
    setDeletedColumns((currentColumns) =>
      currentColumns.filter((column) => column.id !== columnId),
    );
  };

  const downloadCsv = () => {
    if (!parseState) {
      return;
    }

    const headers = parseState.columns.map((column) => column.outputName || column.originalName);
    const sortedRows = parseState.rows.map((row) =>
      parseState.columns.map((column) => row[column.sourceIndex] ?? ""),
    );
    const csv = Papa.unparse([headers, ...sortedRows], {
      newline: "\r\n",
    });
    const blob = new Blob(["\uFEFF", csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = parseState.fileName.replace(/\.csv$/i, "") + "_converted.csv";
    link.click();
    URL.revokeObjectURL(url);
    showSuccessMessage("変換済CSVをダウンロードしました");
  };

  const downloadSampleCsv = () => {
    const blob = new Blob([sampleCsvContent], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sample.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const showSuccessMessage = (message: string) => {
    setSuccessMessage(message);

    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
    }

    successTimerRef.current = setTimeout(() => {
      setSuccessMessage("");
      successTimerRef.current = null;
    }, 2500);
  };

  return (
    <main className="mx-auto w-[min(1180px,calc(100%_-_32px))] py-8 sm:py-10">
      {successMessage ? (
        <div
          className="fixed right-4 top-4 z-50 rounded-lg border border-teal-200 bg-white px-4 py-3 text-sm font-bold text-teal-900 shadow-soft"
          role="status"
        >
          {successMessage}
        </div>
      ) : null}

      <header className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] lg:items-end">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-normal text-teal-800">
            CSV列変換専門ツール
          </p>
          <h1 className="mb-3 text-5xl font-black leading-none tracking-normal text-slate-900 sm:text-7xl">
            CSV列整理くん
          </h1>
          <p className="max-w-2xl text-base leading-8 text-slate-600">
            CSVの列名変更と列順変更を、1画面でそのまま完了できます。
          </p>
        </div>

        <div className="flex gap-3 rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm leading-7 text-teal-950">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-teal-700 font-black text-white">
            ✓
          </span>
          <span>ファイルはブラウザ内で処理され、サーバーには保存されません</span>
        </div>
      </header>

      <section className="grid items-start gap-4 lg:grid-cols-[1fr_1.3fr_0.9fr]">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
          <StepLabel>Step 1</StepLabel>
          <h2 className="mb-4 text-lg font-extrabold text-slate-900">CSVアップロード</h2>

          <label
            className={[
              "grid min-h-56 cursor-pointer place-items-center rounded-lg border-2 border-dashed p-6 text-center transition",
              isDraggingFile
                ? "border-teal-600 bg-teal-50"
                : "border-slate-300 bg-slate-50 hover:border-teal-500",
            ].join(" ")}
            onDragLeave={() => setIsDraggingFile(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDraggingFile(true);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDraggingFile(false);
              const [file] = event.dataTransfer.files;
              if (file) {
                readCsv(file);
              }
            }}
          >
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
            />
            <span className="grid size-12 place-items-center rounded-full bg-slate-100 text-2xl font-black text-teal-800">
              ↑
            </span>
            <span className="mt-4 block font-extrabold text-slate-900">
              CSVをドラッグ&ドロップ
            </span>
            <span className="mt-2 block text-sm text-slate-500">
              またはクリックしてファイルを選択
            </span>
          </label>

          <p className="mt-3 text-sm leading-7 text-slate-600">
            {parseState ? `${parseState.fileName} を読み込みました。` : "まだファイルが選択されていません。"}
          </p>
          <button
            className="mt-3 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900"
            type="button"
            onClick={downloadSampleCsv}
          >
            サンプルCSVをダウンロード
          </button>
          {error ? (
            <div
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold leading-7 text-red-700"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          {duplicateWarning ? (
            <div
              className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-7 text-amber-900"
              role="status"
            >
              <p className="font-bold">{duplicateWarning.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="min-h-9 rounded-lg border border-amber-300 bg-white px-3 font-bold text-amber-900 transition hover:bg-amber-100"
                  type="button"
                  onClick={cancelDuplicateCsv}
                >
                  読み込みを中止
                </button>
                <button
                  className="min-h-9 rounded-lg bg-amber-600 px-3 font-bold text-white transition hover:bg-amber-700"
                  type="button"
                  onClick={allowDuplicateCsv}
                >
                  重複を許可して読み込む
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section
          className={[
            "rounded-lg border border-slate-200 bg-white p-5 shadow-soft",
            hasCsv ? "" : "opacity-60",
          ].join(" ")}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <StepLabel>Step 2 / 3</StepLabel>
              <h2 className="text-lg font-extrabold text-slate-900">列名変更・列順変更</h2>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                className="min-h-9 rounded-lg border border-teal-200 bg-white px-3 text-sm font-bold text-teal-800 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={!parseState}
                onClick={addColumn}
              >
                列を追加
              </button>
              <button
                className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={!parseState}
                onClick={resetColumns}
              >
                元に戻す
              </button>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
            <span>{parseState ? `${parseState.columns.length}列` : "0列"}</span>
            <span>ヘッダー行をドラッグして順番を変更できます。</span>
          </div>

          {parseState ? (
            <>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={parseState.columns.map((column) => column.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="grid max-h-[440px] gap-2 overflow-auto pr-1">
                    {parseState.columns.map((column) => (
                      <SortableColumnRow
                        key={column.id}
                        column={column}
                        onDelete={deleteColumn}
                        onNameChange={updateColumnName}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              {deletedColumns.length > 0 ? (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-extrabold text-slate-800">削除済みの列</h3>
                    <span className="text-xs font-bold text-slate-500">
                      {deletedColumns.length}列
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {deletedColumns.map((column) => (
                      <div
                        key={column.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
                      >
                        <span className="min-w-0 truncate text-sm font-bold text-slate-700">
                          {column.outputName || column.originalName}
                        </span>
                        <button
                          className="min-h-8 rounded-lg border border-teal-200 bg-white px-3 text-xs font-bold text-teal-800 transition hover:bg-teal-50"
                          type="button"
                          onClick={() => restoreDeletedColumn(column.id)}
                        >
                          復元
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>

        <section
          className={[
            "rounded-lg border border-slate-200 bg-white p-5 shadow-soft",
            hasCsv ? "" : "opacity-60",
          ].join(" ")}
        >
          <StepLabel>Step 4</StepLabel>
          <h2 className="mb-4 text-lg font-extrabold text-slate-900">CSVダウンロード</h2>
          <p className="mb-4 text-sm leading-7 text-slate-600">
            変換内容を確認して、CSVを書き出します。
          </p>
          <button
            className="min-h-12 w-full rounded-lg bg-teal-700 px-4 font-extrabold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-teal-700/60"
            type="button"
            disabled={!parseState}
            onClick={downloadCsv}
          >
            変換後CSVをダウンロード
          </button>
        </section>
      </section>

      {parseState ? (
        <section className="mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <StepLabel>Preview</StepLabel>
              <h2 className="text-lg font-extrabold text-slate-900">先頭5行プレビュー</h2>
            </div>
            <p className="text-sm text-slate-500">{parseState.rows.length}行</p>
          </div>

          <div className="overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr>
                  {parseState.columns.map((column) => (
                    <th
                      key={column.id}
                      className="border-b border-slate-200 bg-teal-50 px-3 py-2 text-sm font-extrabold text-teal-950"
                    >
                      {column.outputName || column.originalName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, rowIndex) => (
                  <tr key={`preview-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`preview-${rowIndex}-${cellIndex}`}
                        className="max-w-64 overflow-hidden text-ellipsis whitespace-nowrap border-b border-slate-100 px-3 py-2 text-sm text-slate-700"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <footer className="mt-6 text-center text-xs text-slate-500">
        <a
          className="font-bold underline-offset-4 transition hover:text-teal-800 hover:underline"
          href="https://github.com/pomhiko/csv-reorder/issues"
          target="_blank"
          rel="noreferrer"
        >
          不具合・改善要望
        </a>
      </footer>
    </main>
  );
}

function StepLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-xs font-black uppercase tracking-normal text-teal-800">{children}</p>
  );
}

function SortableColumnRow({
  column,
  onDelete,
  onNameChange,
}: {
  column: ColumnConfig;
  onDelete: (columnId: string) => void;
  onNameChange: (columnId: string, outputName: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "grid grid-cols-[38px_minmax(100px,0.8fr)_minmax(160px,1fr)_auto] items-center gap-3 rounded-lg border border-slate-200 bg-white p-2 sm:p-3",
        isDragging ? "opacity-50" : "",
      ].join(" ")}
    >
      <button
        className="grid size-10 cursor-grab touch-none place-items-center rounded-lg border border-slate-200 bg-slate-50 text-xl font-black leading-none text-slate-500 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800 focus:outline-none focus:ring-4 focus:ring-teal-100 active:cursor-grabbing"
        type="button"
        aria-label={`${column.originalName}を並び替え`}
        {...attributes}
        {...listeners}
      >
        ≡
      </button>

      <div className="min-w-0 truncate font-extrabold text-slate-900" title={column.originalName}>
        {column.originalName}
      </div>

      <label className="grid gap-1 max-sm:col-span-4">
        <span className="text-xs font-extrabold text-slate-500">変更後</span>
        <input
          className="h-10 min-w-0 rounded-lg border border-slate-300 px-3 text-slate-900 outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-100"
          type="text"
          value={column.outputName}
          placeholder={column.originalName}
          onChange={(event) => onNameChange(column.id, event.target.value)}
        />
      </label>

      <button
        className="min-h-10 rounded-lg border border-red-200 bg-white px-3 text-sm font-bold text-red-700 transition hover:bg-red-50 focus:outline-none focus:ring-4 focus:ring-red-100 max-sm:col-span-4"
        type="button"
        onClick={() => onDelete(column.id)}
      >
        削除
      </button>
    </div>
  );
}

function toCellRows(rows: CsvRow[]) {
  return rows.map((row) => row.map((cell) => String(cell ?? "")));
}

function hasRowContent(row: CsvRow) {
  return row.some((cell) => cell.trim() !== "");
}

function createColumns(headerRow: CsvRow) {
  return headerRow.map((name, index) => ({
    id: `column-${index}`,
    originalName: name || `列${index + 1}`,
    outputName: name || `列${index + 1}`,
    sourceIndex: index,
  }));
}

function createAddedColumn(existingColumns: ColumnConfig[]) {
  const nextSourceIndex =
    existingColumns.length === 0
      ? 0
      : Math.max(...existingColumns.map((column) => column.sourceIndex)) + 1;

  return {
    id: `added-column-${nextSourceIndex}`,
    originalName: "新しい列",
    outputName: "新しい列",
    sourceIndex: nextSourceIndex,
  };
}

function findDuplicatedHeaders(headerRow: CsvRow) {
  const counts = new Map<string, number>();

  for (const header of headerRow) {
    const normalizedHeader = header.trim();

    if (!normalizedHeader) {
      continue;
    }

    counts.set(normalizedHeader, (counts.get(normalizedHeader) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([header]) => header);
}

function isCsvFile(file: File) {
  return csvExtensionPattern.test(file.name.trim());
}
