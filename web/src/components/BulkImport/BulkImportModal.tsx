import React, { useRef, useState } from "react";
import type { AddPostDetailedResult, NewPost } from "../../context/PostContext";
import type { Post } from "../../types/post";
import {
  BULK_JSON_TEMPLATE,
  MAX_BULK_JSON_POSTS,
  validateBulkJson,
  type BulkJsonPreviewRow,
  type BulkJsonValidationResult,
} from "../../lib/bulkJsonWorkflow";
import {
  destinationActionLabel,
  destinationToPost,
  sanitizeProcessError,
  type DestinationProcessResult,
} from "../../lib/createPostWorkflow";
import { platformDataMap } from "../common/PlatformIcon";
import { CreateWorkflowTabs, type CreateWorkflowMode } from "../CreatePost/CreateWorkflowTabs";

interface BulkImportModalProps {
  posts: Post[];
  onCreate: (post: NewPost) => Promise<AddPostDetailedResult>;
  onClose: () => void;
  onModeChange: (mode: CreateWorkflowMode) => void;
  onProcessingChange?: (processing: boolean) => void;
}

type Phase = "input" | "preview" | "results";

const rowText = (row: BulkJsonPreviewRow) =>
  row.values.title || row.values.caption || row.values.content || row.values.description || "—";

const mediaLabel = (row: BulkJsonPreviewRow) => {
  if (row.mediaUrls.length) return `${row.mediaUrls.length} image URLs${row.errors.length ? " (check errors)" : ""}`;
  if (!row.mediaUrl) return "None";
  if (row.media) return `${row.media.type === "image" ? "Image" : "Video"} URL`;
  return "Unverified URL";
};

export const BulkImportModal: React.FC<BulkImportModalProps> = ({
  posts,
  onCreate,
  onClose,
  onModeChange,
  onProcessingChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jsonText, setJsonText] = useState(BULK_JSON_TEMPLATE);
  const [phase, setPhase] = useState<Phase>("input");
  const [validation, setValidation] = useState<BulkJsonValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<DestinationProcessResult[]>([]);

  const updateJson = (value: string) => {
    if (processing) return;
    setJsonText(value);
    setValidation(null);
    setPhase("input");
    setResults([]);
  };

  const readJsonFile = (file?: File) => {
    if (!file || processing) return;
    const reader = new FileReader();
    reader.onload = () => updateJson(String(reader.result || ""));
    reader.readAsText(file);
  };

  const validate = async () => {
    if (!jsonText.trim() || validating || processing) return;
    setValidating(true);
    setResults([]);
    try {
      const result = await validateBulkJson(jsonText, posts);
      setValidation(result);
      setPhase("preview");
    } finally {
      setValidating(false);
    }
  };

  const processRows = async () => {
    if (!validation?.valid || processing) return;
    const processable = validation.rows.filter(
      (row): row is BulkJsonPreviewRow & { destination: NonNullable<BulkJsonPreviewRow["destination"]> } => Boolean(row.destination),
    );
    setProcessing(true);
    onProcessingChange?.(true);
    setPhase("results");
    setResults(processable.map((row) => ({ destinationKey: row.destination.key, state: "queued", message: "Pending" })));

    for (const row of processable) {
      const key = row.destination.key;
      setResults((current) => current.map((result) => result.destinationKey === key
        ? { ...result, state: "processing", message: "Creating planner record…" }
        : result));
      try {
        const post = destinationToPost(row.destination, row.media);
        const outcome = await onCreate(post);
        if (outcome.nativeAttempted && !outcome.nativeSucceeded) {
          setResults((current) => current.map((result) => result.destinationKey === key
            ? { ...result, state: "failed", message: "Planner record created; native submission failed", postId: outcome.post.id, error: sanitizeProcessError(outcome.error) }
            : result));
        } else {
          const action = row.action ? destinationActionLabel(row.action) : "Planner record created";
          setResults((current) => current.map((result) => result.destinationKey === key
            ? { ...result, state: "success", message: action, postId: outcome.post.id }
            : result));
        }
      } catch (error) {
        setResults((current) => current.map((result) => result.destinationKey === key
          ? { ...result, state: "failed", message: "Creation failed", error: sanitizeProcessError(error) }
          : result));
      }
    }

    setProcessing(false);
    onProcessingChange?.(false);
  };

  const successful = results.filter((result) => result.state === "success").length;
  const failed = results.filter((result) => result.state === "failed").length;

  return (
    <div className="overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !processing) onClose();
    }}>
      <section className="panel create-workflow bulk-json-workflow" role="dialog" aria-modal="true" aria-labelledby="bulk-json-title">
        <header className="create-header">
          <div><h3 id="bulk-json-title">Create Post</h3><p className="sub">Validate and schedule up to {MAX_BULK_JSON_POSTS} independent posts from JSON.</p></div>
          <button type="button" className="cal-preview-close" onClick={onClose} disabled={processing}>×</button>
        </header>

        <CreateWorkflowTabs active="json" onChange={onModeChange} disabled={processing || validating} />

        <div className="create-body bulk-json-body">
          {phase === "input" && (
            <div>
              <h4>JSON input</h4>
              <p className="create-help">Use schemaVersion 1 and public media URLs. JSON media entries do not upload local files.</p>
              <div className="bulk-json-input-tools">
                <button type="button" className="btn-secondary btn-mini" onClick={() => fileInputRef.current?.click()}>Load .json file</button>
                <button type="button" className="btn-secondary btn-mini" onClick={() => updateJson(BULK_JSON_TEMPLATE)}>Reset example</button>
                <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={(event) => readJsonFile(event.target.files?.[0])} />
              </div>
              <textarea className="json-code bulk-json-editor" value={jsonText} onChange={(event) => updateJson(event.target.value)} spellCheck={false} aria-label="Bulk scheduling JSON" />
              <details className="bulk-json-schema-help">
                <summary>Schema fields</summary>
                <p>Root: <code>schemaVersion</code>, <code>posts</code>. Post: <code>platform</code>, <code>contentType</code>, optional <code>mediaUrl</code> (single image/video), <code>mediaUrls</code> (Facebook Multiple Images only, at least two image URLs in order), relevant text fields, <code>date</code>, and <code>time</code>. Unknown fields are rejected.</p>
              </details>
            </div>
          )}

          {phase === "preview" && validation && (
            <div>
              <h4>Validation preview</h4>
              <p className="create-help">No planner records have been created. Correct every blocking error before confirmation.</p>
              {validation.rootErrors.length > 0 && <div className="create-errors">{validation.rootErrors.map((error) => <div key={error}>{error}</div>)}</div>}
              <div className="bulk-preview-scroll">
                <table className="preview-table bulk-preview-table">
                  <thead><tr><th>Row</th><th>Platform</th><th>Type</th><th>Media</th><th>Title / content</th><th>Date</th><th>Time</th><th>Action</th><th>Status</th></tr></thead>
                  <tbody>
                    {validation.rows.map((row) => (
                      <tr key={row.row} className={row.errors.length ? "bulk-row-invalid" : "bulk-row-valid"}>
                        <td className="num">{row.row}</td>
                        <td>{row.destination ? platformDataMap[row.destination.platform].name : row.values.platform || "—"}</td>
                        <td>{row.destination?.contentType || row.values.contentType || "—"}</td>
                        <td>{mediaLabel(row)}</td>
                        <td><span className="bulk-preview-text" title={rowText(row)}>{rowText(row)}</span></td>
                        <td>{row.values.date || "—"}</td>
                        <td>{row.values.time || "—"}</td>
                        <td>{row.action ? destinationActionLabel(row.action) : "—"}</td>
                        <td>
                          <strong className={row.errors.length ? "bulk-status-error" : "bulk-status-ready"}>{row.errors.length ? "Error" : "Ready"}</strong>
                          {row.errors.map((error) => <small className="bulk-row-message" key={error}>{error}</small>)}
                          {row.warnings.map((warning) => <small className="bulk-row-warning" key={warning}>{warning}</small>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {phase === "results" && validation && (
            <div>
              <h4>{processing ? "Processing posts" : "Bulk scheduling results"}</h4>
              <p className="create-help">Each entry is processed independently. A failed entry does not roll back successful entries.</p>
              <div className="result-summary"><span>Successful: <strong>{successful}</strong></span><span>Failed: <strong>{failed}</strong></span></div>
              <div className="create-results">
                {validation.rows.map((row) => {
                  const result = results.find((item) => item.destinationKey === row.destination?.key);
                  return (
                    <div key={row.row} className={`create-result ${result?.state || "queued"}`}>
                      <span className="result-state">{result?.state === "success" ? "✓" : result?.state === "failed" ? "!" : result?.state === "processing" ? "…" : "·"}</span>
                      <div><strong>Row {row.row} · {row.destination ? platformDataMap[row.destination.platform].name : row.values.platform}</strong><span>{row.destination?.contentType || row.values.contentType}</span><small>{result?.message || "Pending"}</small>{result?.error && <small>{result.error}</small>}</div>
                      <strong>{result?.state === "queued" ? "Pending" : result?.state === "processing" ? "Processing" : result?.state === "success" ? "Success" : "Failed"}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="panel-actions create-actions">
          <div className="left">{phase === "preview" && <button type="button" className="btn-secondary" onClick={() => setPhase("input")}>Edit JSON</button>}</div>
          <div className="right">
            {phase === "input" && <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>}
            {phase === "input" && <button type="button" className="btn-primary" onClick={validate} disabled={!jsonText.trim() || validating}>{validating ? "Validating media…" : "Validate & Preview"}</button>}
            {phase === "preview" && <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>}
            {phase === "preview" && <button type="button" className="btn-primary" onClick={processRows} disabled={!validation?.valid}>Confirm & Process</button>}
            {phase === "results" && !processing && <button type="button" className="btn-primary" onClick={onClose}>Done</button>}
          </div>
        </div>
      </section>
    </div>
  );
};
