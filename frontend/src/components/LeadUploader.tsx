/**
 * LeadUploader — CSV/TXT upload and paste, with an immediate parse summary.
 *
 * WHAT THE USER SEES: "14 addresses detected · 2 duplicates removed · 1 invalid"
 * before anything is submitted. Invalid addresses are listed so a typo in a
 * spreadsheet can be fixed at the source.
 *
 * WHY A DRAG-DROP ZONE AND NOT JUST A FILE INPUT
 * It is a large, obvious target; the native input is kept (visually hidden but
 * focusable) so keyboard users and screen readers get the standard behaviour
 * rather than a div that merely looks clickable.
 */
import { useRef, useState, type DragEvent } from 'react';
import { Alert, Spinner } from './ui/Feedback';
import { Badge } from './ui/Badge';
import { parseLeadsFile, parseLeadsPasted, type ParsedLeadsResult } from '../utils/parseLeads';

interface LeadUploaderProps {
  parsed: ParsedLeadsResult | null;
  onParsed: (result: ParsedLeadsResult | null) => void;
  error?: string | undefined;
  maxRecipients: number;
}

export function LeadUploader({ parsed, onParsed, error, maxRecipients }: LeadUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState('');

  async function handleFile(file: File): Promise<void> {
    setLocalError(null);
    setReading(true);
    try {
      const result = await parseLeadsFile(file);
      if (result.valid.length === 0) {
        setLocalError(
          result.totalCandidates === 0
            ? `No email addresses found in “${file.name}”. Check that the file contains an email column.`
            : `Found ${result.totalCandidates} candidate(s) but none were valid addresses.`,
        );
        onParsed(null);
        return;
      }
      onParsed(result);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Could not read that file');
      onParsed(null);
    } finally {
      setReading(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function handlePaste(): void {
    setLocalError(null);
    const result = parseLeadsPasted(pastedText);
    if (result.valid.length === 0) {
      setLocalError('No valid email addresses found in the pasted text');
      onParsed(null);
      return;
    }
    onParsed(result);
  }

  const shownError = error ?? localError;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">
          Recipients<span className="ml-0.5 text-rose-500">*</span>
        </span>

        {/* Two ways in: a file, or paste from anywhere. */}
        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
          {(['upload', 'paste'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize transition-colors ${
                mode === option ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {mode === 'upload' ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${
            dragging ? 'border-brand-400 bg-brand-50' : 'border-slate-300 bg-slate-50/60'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              // Reset the input so choosing the same file twice still fires change.
              event.target.value = '';
            }}
          />

          {reading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
              <Spinner size={16} /> Reading file…
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-sm font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
              >
                Choose a CSV or TXT file
              </button>
              <p className="mt-1 text-xs text-slate-500">or drag and drop it here · max 2 MB</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            rows={5}
            value={pastedText}
            onChange={(event) => setPastedText(event.target.value)}
            placeholder={'john@example.com\njane@example.com\nsales@acme.co'}
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-700 placeholder:text-slate-400"
            aria-label="Paste email addresses"
          />
          <button
            type="button"
            onClick={handlePaste}
            disabled={pastedText.trim() === ''}
            className="text-xs font-medium text-brand-700 underline underline-offset-2 disabled:text-slate-400 disabled:no-underline"
          >
            Detect addresses
          </button>
        </div>
      )}

      {shownError ? (
        <p className="text-xs font-medium text-rose-600">{shownError}</p>
      ) : null}

      {/* ---- parse summary ------------------------------------------------- */}
      {parsed ? (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">
              {parsed.valid.length} address{parsed.valid.length === 1 ? '' : 'es'} detected
            </Badge>

            {parsed.duplicatesRemoved > 0 ? (
              <Badge tone="neutral">{parsed.duplicatesRemoved} duplicate(s) removed</Badge>
            ) : null}

            {parsed.invalid.length > 0 ? (
              <Badge tone="error">{parsed.invalid.length} invalid</Badge>
            ) : null}
          </div>

          {/* Show the first few addresses so the user can confirm the right file
              was chosen — a wrong upload is otherwise invisible until it sends. */}
          <p className="mt-2 break-words text-xs text-slate-500">
            {parsed.valid.slice(0, 4).join(', ')}
            {parsed.valid.length > 4 ? `, +${parsed.valid.length - 4} more` : ''}
          </p>

          {parsed.invalid.length > 0 ? (
            <p className="mt-1 break-words text-xs text-rose-600">
              Skipped: {parsed.invalid.slice(0, 5).join(', ')}
              {parsed.invalid.length > 5 ? ` (+${parsed.invalid.length - 5})` : ''}
            </p>
          ) : null}

          {parsed.truncated ? (
            <div className="mt-2">
              <Alert tone="warning">
                Only the first {maxRecipients} addresses were kept. Split larger lists into several
                batches.
              </Alert>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
