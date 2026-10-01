import { useEffect, useMemo, useRef, useState } from "react";
import { hasCloudinaryConfig, isImageFile, SUPPORTED_IMAGE_TYPES, uploadMediaFile, validateMediaFile } from "../../lib/cloudinary";
import { useToast } from "../common/Toast";
import "./MediaUpload.css";

const MAX_IMAGES = 50;
const CONCURRENCY = 4;
type Status = "Ready" | "Uploading" | "Uploaded" | "Failed";
interface MediaResult {
  fileName: string;
  url: string;
  publicId: string;
  type: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
}
interface SelectedImage {
  id: string;
  file: File;
  preview: string;
  status: Status;
  error?: string;
  result?: MediaResult;
}

function uploadError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Upload failed. Please retry.";
  // The shared helper includes Cloudinary's JSON error body in its error message.
  const bodyStart = message.indexOf("{");
  if (bodyStart >= 0) {
    try {
      const body = JSON.parse(message.slice(bodyStart));
      if (typeof body.error?.message === "string") return body.error.message.slice(0, 240);
    } catch { /* Fall back to the original error. */ }
  }
  return message.slice(0, 240);
}

export function MediaUpload() {
  const { showToast } = useToast();
  const [images, setImages] = useState<SelectedImage[]>([]);
  const imagesRef = useRef<SelectedImage[]>([]);
  const mounted = useRef(true);
  const runningRef = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [messages, setMessages] = useState<string[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const configured = hasCloudinaryConfig();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.preview));
    };
  }, []);

  function updateImages(next: SelectedImage[]) {
    imagesRef.current = next;
    setImages(next);
  }

  function patchImage(id: string, patch: Partial<SelectedImage>) {
    if (!mounted.current) return;
    updateImages(imagesRef.current.map((image) => image.id === id ? { ...image, ...patch } : image));
  }

  function addFiles(files: File[]) {
    if (runningRef.current) return;
    const next = [...imagesRef.current];
    const identities = new Set(next.map((image) => image.id));
    const errors: string[] = [];
    let duplicates = 0;
    let excess = 0;
    for (const file of files) {
      const validation = validateMediaFile(file);
      if (!validation.valid || !isImageFile(file) || file.size === 0) {
        errors.push(`${file.name}: ${file.size === 0 ? "File is empty." : !validation.valid ? validation.error : "Images only."}`);
        continue;
      }
      const id = JSON.stringify([file.name, file.size, file.lastModified]);
      if (identities.has(id)) { duplicates++; continue; }
      if (next.length >= MAX_IMAGES) { excess++; continue; }
      next.push({ id, file, preview: URL.createObjectURL(file), status: "Ready" });
      identities.add(id);
    }
    if (duplicates) errors.push(`${duplicates} duplicate file(s) skipped.`);
    if (excess) errors.push(`${excess} excess image(s) skipped. Maximum ${MAX_IMAGES} per batch.`);
    updateImages(next);
    setMessages(errors);
  }

  function removeImage(id: string) {
    if (runningRef.current) return;
    const image = imagesRef.current.find((item) => item.id === id);
    if (image?.status !== "Ready") return;
    URL.revokeObjectURL(image.preview);
    updateImages(imagesRef.current.filter((item) => item.id !== id));
  }

  function resetBatch() {
    if (runningRef.current) return;
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.preview));
    updateImages([]);
    setMessages([]);
    setProgress({ completed: 0, total: 0 });
    setDragging(false);
    dragDepth.current = 0;
    if (picker.current) picker.current.value = "";
  }

  async function upload(status: "Ready" | "Failed") {
    if (runningRef.current || !configured) return;
    const queue = imagesRef.current.filter((image) => image.status === status);
    if (!queue.length) return;
    runningRef.current = true;
    setRunning(true);
    setProgress({ completed: 0, total: queue.length });
    let cursor = 0;
    let completed = 0;
    async function worker() {
      while (mounted.current && cursor < queue.length) {
        const image = queue[cursor++];
        patchImage(image.id, { status: "Uploading", error: undefined });
        try {
          const result = await uploadMediaFile(image.file, { folder: "social_planner" });
          if (!result.secure_url?.startsWith("https://") || !result.public_id || !result.format
            || typeof result.width !== "number" || typeof result.height !== "number"
            || typeof result.bytes !== "number") {
            throw new Error("Cloudinary returned incomplete image metadata. Please retry.");
          }
          patchImage(image.id, { status: "Uploaded", result: {
            fileName: image.file.name, url: result.secure_url, publicId: result.public_id,
            type: result.resource_type, format: result.format, width: result.width,
            height: result.height, bytes: result.bytes,
          } });
        } catch (error) {
          patchImage(image.id, { status: "Failed", error: uploadError(error) });
        } finally {
          completed++;
          if (mounted.current) setProgress({ completed, total: queue.length });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));
    runningRef.current = false;
    if (mounted.current) setRunning(false);
  }

  const media = useMemo(() => images.flatMap((image) => image.status === "Uploaded" && image.result ? [image.result] : []), [images]);
  const json = useMemo(() => JSON.stringify({ media }, null, 2), [media]);
  const ready = images.filter((image) => image.status === "Ready").length;
  const failed = images.filter((image) => image.status === "Failed").length;

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      if (mounted.current) showToast("Copied", "Copied to clipboard.", "success", 1800);
    } catch {
      if (mounted.current) showToast("Copy failed", "Clipboard unavailable. Select and copy the output manually.", "error");
    }
  }

  function downloadJson() {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `media-upload-${date}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return <section className="media-upload" aria-label="Media Upload">
    <div className="media-heading"><div><h2>Media Upload</h2><p>Upload images to Cloudinary and export their filename-to-URL mapping.</p></div>
      <button type="button" className="btn-secondary" disabled={running || !images.length} onClick={resetBatch}>New Batch</button>
    </div>
    <p className="media-help">This batch stays in this tab while you switch sections. Download JSON before refreshing or closing the tab.</p>
    {!configured && <p className="media-error" role="alert">Cloudinary is not configured. Set the existing VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET to enable uploads.</p>}
    <div className={`media-drop${dragging ? " is-dragging" : ""}`} onDragEnter={(event) => {
      event.preventDefault(); dragDepth.current++; if (!runningRef.current) setDragging(true);
    }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = running ? "none" : "copy"; }}
      onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}>
      <strong>Drag and drop images here</strong><span>JPEG, PNG, WebP, GIF, BMP · Up to 50 images · 100 MiB per image</span>
      <button type="button" className="btn-secondary" disabled={running || images.length >= MAX_IMAGES} onClick={() => picker.current?.click()}>Select Images</button>
      <input ref={picker} type="file" multiple accept={SUPPORTED_IMAGE_TYPES.join(",")} hidden disabled={running} onChange={(event) => {
        addFiles(Array.from(event.target.files || [])); event.target.value = "";
      }} />
    </div>
    {messages.length > 0 && <div className="media-validation" role="alert"><strong>Some files were skipped</strong><ul>{messages.map((message, index) => <li key={index}>{message}</li>)}</ul></div>}
    <div className="media-actions"><h3>Selected Images <span>{images.length} / 50</span></h3>
      <button type="button" className="btn-secondary" disabled={running || !images.length} onClick={resetBatch}>Clear All</button>
    </div>
    {!images.length ? <p className="media-empty">Select images to preview them before uploading.</p> : <ul className="media-selected">{images.map((image) => <li key={image.id}>
      <img src={image.preview} alt={`Preview of ${image.file.name}`} loading="lazy" />
      <div className="media-file"><strong title={image.file.name}>{image.file.name}</strong><span>{image.file.size < 1024 * 1024 ? `${(image.file.size / 1024).toFixed(1)} KiB` : `${(image.file.size / 1024 / 1024).toFixed(1)} MiB`}</span>
        {image.error && <small className="media-error">{image.error}</small>}</div>
      <span className={`media-status is-${image.status.toLowerCase()}`}>{image.status}</span>
      {image.status === "Ready" && <button type="button" className="btn-secondary btn-mini" disabled={running} aria-label={`Remove ${image.file.name}`} onClick={() => removeImage(image.id)}>Remove</button>}
    </li>)}</ul>}
    <div className="media-actions">
      <button type="button" className="btn-primary" disabled={running || !ready || !configured} onClick={() => void upload("Ready")}>Upload Images{ready > 0 ? ` (${ready})` : ""}</button>
      <button type="button" className="btn-secondary" disabled={running || !failed || !configured} onClick={() => void upload("Failed")}>Retry Failed{failed > 0 ? ` (${failed})` : ""}</button>
      <span className="media-help" role="status">{progress.total > 0 ? `${running ? "Uploading" : "Completed"} ${progress.completed} / ${progress.total} · ${media.length} uploaded · ${failed} failed` : "Four images upload at a time."}</span>
    </div>
    {progress.total > 0 && <progress className="media-progress" value={progress.completed} max={progress.total} aria-label="Completed upload attempts" />}
    {progress.total > 0 && <section className="media-results"><h3>Upload Results</h3><div className="media-table-wrap"><table>
      <colgroup><col style={{ width: 80 }} /><col style={{ width: "26%" }} /><col style={{ width: 100 }} /><col /><col style={{ width: 110 }} /></colgroup>
      <thead><tr><th>Preview</th><th>Filename</th><th>Status</th><th>Cloudinary URL</th><th>Copy</th></tr></thead>
      <tbody>{images.map((image) => <tr key={image.id}><td><img src={image.preview} alt="" loading="lazy" /></td>
        <td><span className="media-truncate" title={image.file.name}>{image.file.name}</span></td><td><span className={`media-status is-${image.status.toLowerCase()}`}>{image.status}</span></td>
        <td>{image.result ? <a className="media-truncate" href={image.result.url} title={image.result.url} target="_blank" rel="noopener noreferrer">{image.result.url}</a> : <span className={image.error ? "media-error" : "media-help"}>{image.error || "—"}</span>}</td>
        <td><button type="button" className="btn-secondary btn-mini" disabled={!image.result} onClick={() => image.result && void copy(image.result.url)}>Copy URL</button></td></tr>)}</tbody>
    </table></div></section>}
    <section className="media-output"><div className="media-actions"><h3>JSON Output <span>{media.length} image{media.length === 1 ? "" : "s"}</span></h3>
      <button type="button" className="btn-secondary" disabled={!media.length} onClick={() => void copy(json)}>Copy JSON</button>
      <button type="button" className="btn-secondary" disabled={!media.length} onClick={downloadJson}>Download JSON</button>
    </div><pre tabIndex={0} aria-label="Generated media JSON"><code>{json}</code></pre></section>
  </section>;
}
