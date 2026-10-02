import React, { useEffect, useRef, useState } from "react";
import { isImageFile, uploadMediaFile, validateMediaFile } from "../../lib/cloudinary";
import { normalizeSourceIdentity, sanitizeProcessError, type CreateMediaSource } from "../../lib/createPostWorkflow";

interface ImageRow { id: number; name: string; preview: string; media?: CreateMediaSource; error?: string; }

export const MultipleImagesSource: React.FC<{
  onChange: (images: CreateMediaSource[]) => void;
  onBusy: (busy: boolean) => void;
}> = ({ onChange, onBusy }) => {
  const [rows, setRows] = useState<ImageRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nextId = useRef(0);
  const localUrls = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      localUrls.current.forEach((url) => URL.revokeObjectURL(url));
      localUrls.current.clear();
    };
  }, []);
  useEffect(() => { onChange(rows.flatMap((row) => row.media ? [row.media] : [])); }, [rows, onChange]);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || busy) return;
    const invalid = files.find((file) => !isImageFile(file) || !validateMediaFile(file).valid);
    if (invalid) {
      setError(`${invalid.name}: ${!isImageFile(invalid) ? "Multiple Images accepts images only." : validateMediaFile(invalid).error}`);
      return;
    }
    setError("");
    setBusy(true);
    onBusy(true);
    const batch = files.map((file) => {
      const preview = URL.createObjectURL(file);
      localUrls.current.add(preview);
      return { file, row: { id: nextId.current++, name: file.name, preview } };
    });
    setRows((current) => [...current, ...batch.map(({ row }) => row)]);
    try {
      // Upload sequentially to keep concurrency bounded and selection order stable.
      for (const { file, row } of batch) {
        if (!mounted.current) break;
        try {
          const uploaded = await uploadMediaFile(file, { folder: "social_planner" });
          if (mounted.current) setRows((current) => current.map((item) => item.id === row.id ? {
            ...item, preview: uploaded.secure_url,
            media: { url: uploaded.secure_url, type: "image", identity: normalizeSourceIdentity(uploaded.secure_url), origin: "upload", publicId: uploaded.public_id, bytes: uploaded.bytes || file.size },
          } : item));
        } catch (failure) {
          if (mounted.current) setRows((current) => current.map((item) => item.id === row.id ? { ...item, preview: "", error: sanitizeProcessError(failure) } : item));
        } finally {
          if (localUrls.current.delete(row.preview)) URL.revokeObjectURL(row.preview);
        }
      }
    } finally {
      if (mounted.current) { setBusy(false); onBusy(false); }
    }
  };

  return <div className="create-source-box">
    <label>Facebook Multiple Images · select at least two images in posting order</label>
    <input type="file" accept="image/*" multiple onChange={upload} disabled={busy} />
    {busy && <small>Uploading images to Cloudinary…</small>}
    {error && <div className="create-errors">{error}</div>}
    {rows.map((row, index) => <div className="create-media-preview" key={row.id}>
      {row.preview && <img src={row.preview} alt={`${index + 1}. ${row.name}`} />}
      <div><strong>{index + 1}. {row.name}</strong><span>{row.error || (row.media ? "Uploaded" : "Uploading / queued")}</span></div>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>Remove image {index + 1}</button>
    </div>)}
  </div>;
};
