import React, { useMemo, useRef, useState } from "react";
import { PlatformIcon, platformDataMap } from "../common/PlatformIcon";
import type { Post } from "../../types/post";
import type { AddPostDetailedResult, NewPost } from "../../context/PostContext";
import {
  PLATFORM_CAPABILITIES,
  type PublishingPlatform,
} from "../../lib/contentTypes";
import {
  compatibleDestinations,
  createDestinationDraft,
  destinationAction,
  destinationActionLabel,
  destinationToPost,
  findDuplicateConflicts,
  normalizeSourceIdentity,
  validateDestination,
  validateRemoteMediaUrl,
  type CreateMediaSource,
  type DestinationDraft,
  type DestinationProcessResult,
} from "../../lib/createPostWorkflow";
import {
  getSupportedTypes,
  isImageFile,
  uploadMediaFile,
  validateMediaFile,
} from "../../lib/cloudinary";

interface CreatePostWorkflowProps {
  posts: Post[];
  initialDate?: string;
  initialPlatform?: PublishingPlatform;
  onCreate: (post: NewPost) => Promise<AddPostDetailedResult>;
  onClose: () => void;
  onProcessingChange?: (processing: boolean) => void;
}

type Step = "content" | "platforms" | "details" | "review" | "results";
type ContentMode = "text" | "upload" | "url";

const STEPS: { key: Step; label: string }[] = [
  { key: "content", label: "Content" },
  { key: "platforms", label: "Platforms" },
  { key: "details", label: "Platform details" },
  { key: "review", label: "Review" },
  { key: "results", label: "Results" },
];

const todayLocal = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const previewText = (destination: DestinationDraft) =>
  destination.title || destination.caption || destination.content || destination.description || "No text";

const safeError = (value: unknown) => {
  const text = value instanceof Error ? value.message : String(value || "Unknown error");
  return text
    .replace(/(access_token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .slice(0, 500);
};

export const CreatePostWorkflow: React.FC<CreatePostWorkflowProps> = ({
  posts,
  initialDate,
  initialPlatform,
  onCreate,
  onClose,
  onProcessingChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("content");
  const [contentMode, setContentMode] = useState<ContentMode>("text");
  const [media, setMedia] = useState<CreateMediaSource | null>(null);
  const [mediaUrlInput, setMediaUrlInput] = useState("");
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [validatingUrl, setValidatingUrl] = useState(false);
  const [contentError, setContentError] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [destinations, setDestinations] = useState<DestinationDraft[]>([]);
  const [detailErrors, setDetailErrors] = useState<Record<string, string[]>>({});
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<DestinationProcessResult[]>([]);

  const activeMedia = contentMode === "text" ? null : media;
  const options = useMemo(() => compatibleDestinations(activeMedia?.type || null), [activeMedia?.type]);
  const conflicts = useMemo(
    () => findDuplicateConflicts(destinations, activeMedia, posts),
    [destinations, activeMedia, posts],
  );
  const currentStepIndex = STEPS.findIndex((item) => item.key === step);

  const selectMode = (mode: ContentMode) => {
    if (processing) return;
    setContentMode(mode);
    setContentError("");
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const validation = validateMediaFile(file);
    if (!validation.valid) {
      setContentError(validation.error || "Invalid media file.");
      return;
    }

    setUploading(true);
    setContentError("");
    const localPreview = URL.createObjectURL(file);
    setMediaPreview(localPreview);
    try {
      const uploaded = await uploadMediaFile(file, { folder: "social_planner" });
      const type = isImageFile(file) ? "image" : "video";
      URL.revokeObjectURL(localPreview);
      setMediaPreview(uploaded.secure_url);
      setMedia({
        url: uploaded.secure_url,
        type,
        identity: normalizeSourceIdentity(uploaded.secure_url),
        origin: "upload",
        publicId: uploaded.public_id,
        bytes: uploaded.bytes || file.size,
      });
    } catch (error) {
      setMedia(null);
      setMediaPreview(null);
      URL.revokeObjectURL(localPreview);
      setContentError(safeError(error));
    } finally {
      setUploading(false);
    }
  };

  const validateUrl = async () => {
    setValidatingUrl(true);
    setContentError("");
    try {
      const validated = await validateRemoteMediaUrl(mediaUrlInput);
      setMedia(validated);
      setMediaPreview(validated.url);
    } catch (error) {
      setMedia(null);
      setMediaPreview(null);
      setContentError(safeError(error));
    } finally {
      setValidatingUrl(false);
    }
  };

  const goToPlatforms = () => {
    if (contentMode !== "text" && !media) {
      setContentError(contentMode === "upload" ? "Upload media successfully before continuing." : "Validate the media URL before continuing.");
      return;
    }
    const compatibleKeys = new Set(options.map((option) => option.key));
    let nextSelected = selectedKeys.filter((key) => compatibleKeys.has(key));
    if (!nextSelected.length && initialPlatform) {
      const preferred = options.find((option) => option.platform === initialPlatform);
      if (preferred) nextSelected = [preferred.key];
    }
    setSelectedKeys(nextSelected);
    setStep("platforms");
  };

  const goToDetails = () => {
    if (!selectedKeys.length) return;
    const defaultDate = initialDate || todayLocal();
    setDestinations((current) => selectedKeys.map((key) => {
      const existing = current.find((destination) => destination.key === key);
      const option = options.find((item) => item.key === key)!;
      return existing || createDestinationDraft(option, defaultDate);
    }));
    setDetailErrors({});
    setStep("details");
  };

  const updateDestination = (key: string, changes: Partial<DestinationDraft>) => {
    setDestinations((current) => current.map((destination) =>
      destination.key === key ? { ...destination, ...changes } : destination));
    setDetailErrors((current) => ({ ...current, [key]: [] }));
  };

  const validateAllDetails = () => {
    const errors: Record<string, string[]> = {};
    destinations.forEach((destination) => {
      const result = validateDestination(destination, activeMedia);
      if (result.errors.length) errors[destination.key] = result.errors;
    });
    setDetailErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const goToReview = () => {
    if (!validateAllDetails()) return;
    setStep("review");
  };

  const processDestinations = async () => {
    if (!validateAllDetails() || conflicts.length) {
      if (conflicts.length) setStep("review");
      else setStep("details");
      return;
    }

    setProcessing(true);
    onProcessingChange?.(true);
    setStep("results");
    setResults(destinations.map((destination) => ({
      destinationKey: destination.key,
      state: "queued",
      message: "Waiting",
    })));

    for (const destination of destinations) {
      setResults((current) => current.map((result) => result.destinationKey === destination.key
        ? { ...result, state: "processing", message: "Creating planner record…" }
        : result));
      try {
        const postData = destinationToPost(destination, activeMedia);
        const action = destinationAction(destination, postData.scheduledAt!);
        const outcome = await onCreate(postData);
        if (outcome.nativeAttempted && !outcome.nativeSucceeded) {
          setResults((current) => current.map((result) => result.destinationKey === destination.key
            ? {
                ...result,
                state: "failed",
                message: "Planner record created; native submission failed",
                postId: outcome.post.id,
                error: safeError(outcome.error),
              }
            : result));
          continue;
        }

        const message = action === "planner-scheduled"
          ? "Created / scheduled in planner"
          : action === "facebook-immediate"
            ? "Immediate publishing successful"
            : "Native scheduling successful";
        setResults((current) => current.map((result) => result.destinationKey === destination.key
          ? { ...result, state: "success", message, postId: outcome.post.id }
          : result));
      } catch (error) {
        setResults((current) => current.map((result) => result.destinationKey === destination.key
          ? { ...result, state: "failed", message: "Creation failed", error: safeError(error) }
          : result));
      }
    }

    setProcessing(false);
    onProcessingChange?.(false);
  };

  const renderMediaPreview = () => {
    if (!activeMedia || !mediaPreview) return null;
    return (
      <div className="create-media-preview">
        {activeMedia.type === "image"
          ? <img src={mediaPreview} alt="Selected media" />
          : <video src={mediaPreview} controls preload="metadata" />}
        <div><strong>{activeMedia.type === "image" ? "Image" : "Video"}</strong><span>{activeMedia.origin === "upload" ? "Uploaded once to Cloudinary" : "Verified public URL"}</span></div>
      </div>
    );
  };

  const successful = results.filter((result) => result.state === "success").length;
  const failed = results.filter((result) => result.state === "failed").length;

  return (
    <div className="overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !processing) onClose();
    }}>
      <section className="panel create-workflow" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <header className="create-header">
          <div><h3 id="create-title">Create Post</h3><p className="sub">Create one or more independent destination posts.</p></div>
          <button type="button" className="cal-preview-close" onClick={onClose} disabled={processing}>×</button>
        </header>

        <ol className="create-steps" aria-label="Create Post progress">
          {STEPS.map((item, index) => (
            <li key={item.key} className={`${item.key === step ? "active" : ""}${index < currentStepIndex ? " complete" : ""}`}>
              <span>{index + 1}</span>{item.label}
            </li>
          ))}
        </ol>

        <div className="create-body">
          {step === "content" && (
            <div>
              <h4>Choose the source content</h4>
              <div className="create-mode-picker">
                <button type="button" className={contentMode === "text" ? "active" : ""} onClick={() => selectMode("text")}>Text only</button>
                <button type="button" className={contentMode === "upload" ? "active" : ""} onClick={() => selectMode("upload")}>Upload media</button>
                <button type="button" className={contentMode === "url" ? "active" : ""} onClick={() => selectMode("url")}>Public media URL</button>
              </div>

              {contentMode === "text" && <div className="create-note">Text-only content can be sent to Threads Text or Facebook Text. Enter the platform-specific text later.</div>}
              {contentMode === "upload" && (
                <div className="create-source-box">
                  <input ref={fileInputRef} type="file" accept={getSupportedTypes().join(",")} onChange={handleFile} hidden />
                  <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    {uploading ? "Uploading to Cloudinary…" : media?.origin === "upload" ? "Replace uploaded media" : "Choose image or video"}
                  </button>
                  {uploading && <div className="create-upload-progress"><span /></div>}
                  <small>The file is validated using its browser MIME type and uploaded once for all destinations.</small>
                </div>
              )}
              {contentMode === "url" && (
                <div className="create-source-box">
                  <label>Existing public media URL</label>
                  <div className="create-url-row">
                    <input type="text" value={mediaUrlInput} onChange={(event) => {
                      setMediaUrlInput(event.target.value);
                      setMedia(null);
                      setMediaPreview(null);
                      setContentError("");
                    }} placeholder="https://…" />
                    <button type="button" className="btn-secondary" onClick={validateUrl} disabled={validatingUrl || !mediaUrlInput.trim()}>
                      {validatingUrl ? "Checking…" : "Validate"}
                    </button>
                  </div>
                  <small>Type is determined from response metadata or a browser media probe, not only the filename.</small>
                </div>
              )}
              {renderMediaPreview()}
              {contentError && <div className="create-errors">{contentError}</div>}
            </div>
          )}

          {step === "platforms" && (
            <div>
              <h4>Select destinations</h4>
              <p className="create-help">Each selection creates a separate planner post. The same source media is reused.</p>
              <div className="destination-options">
                {options.map((option) => {
                  const selected = selectedKeys.includes(option.key);
                  return (
                    <button type="button" key={option.key} className={selected ? "selected" : ""} onClick={() => {
                      setSelectedKeys((current) => selected ? current.filter((key) => key !== option.key) : [...current, option.key]);
                    }}>
                      <PlatformIcon platform={option.platform} iconOnly />
                      <span><strong>{platformDataMap[option.platform].name}</strong><small>{option.contentType}</small></span>
                      <span className="destination-check">{selected ? "✓" : "+"}</span>
                    </button>
                  );
                })}
              </div>
              {!selectedKeys.length && <div className="create-note">Select at least one destination.</div>}
            </div>
          )}

          {step === "details" && (
            <div>
              <h4>Platform details</h4>
              <div className="destination-details">
                {destinations.map((destination) => {
                  const capability = PLATFORM_CAPABILITIES[destination.platform];
                  const errors = detailErrors[destination.key] || [];
                  return (
                    <section className="destination-card" key={destination.key}>
                      <div className="destination-card-title"><PlatformIcon platform={destination.platform} iconOnly /><strong>{capability.name} · {destination.contentType}</strong></div>
                      {capability.fields.title !== "unsupported" && (
                        <><label>Title{capability.fields.title === "required" ? " *" : ""}</label><input type="text" value={destination.title} onChange={(event) => updateDestination(destination.key, { title: event.target.value })} /></>
                      )}
                      {destination.platform === "ig" && (
                        <><label>Caption</label><textarea value={destination.caption} onChange={(event) => updateDestination(destination.key, { caption: event.target.value })} /></>
                      )}
                      {(destination.platform === "th" || destination.platform === "fb") && (
                        <><label>Content{destination.platform === "th" || destination.contentType === "Text" ? " *" : ""}</label><textarea value={destination.content} onChange={(event) => updateDestination(destination.key, { content: event.target.value })} /></>
                      )}
                      {destination.platform === "yt" && (
                        <><label>Description</label><textarea value={destination.description} onChange={(event) => updateDestination(destination.key, { description: event.target.value })} /></>
                      )}
                      <div className="destination-schedule">
                        <div><label>Date *</label><input type="date" value={destination.date} onChange={(event) => updateDestination(destination.key, { date: event.target.value })} /></div>
                        <div><label>Time *</label><input type="time" value={destination.time} onChange={(event) => updateDestination(destination.key, { time: event.target.value })} /></div>
                      </div>
                      {destination.contentType === "Story Video" && capability.limits.storyVideoMaxBytes && (
                        <small>Story Video limit: {(capability.limits.storyVideoMaxBytes / 1024 / 1024).toFixed(0)} MB</small>
                      )}
                      {errors.length > 0 && <ul className="create-errors">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
                    </section>
                  );
                })}
              </div>
            </div>
          )}

          {step === "review" && (
            <div>
              <h4>Review and confirm</h4>
              {conflicts.length > 0 && (
                <div className="create-conflicts"><strong>Duplicate conflicts must be resolved</strong>{conflicts.map((conflict) => <div key={`${conflict.destinationKey}-${conflict.message}`}>{conflict.destinationKey}: {conflict.message}</div>)}</div>
              )}
              <div className="review-destinations">
                {destinations.map((destination) => {
                  const validation = validateDestination(destination, activeMedia);
                  const action = validation.scheduledAt ? destinationAction(destination, validation.scheduledAt) : "planner-scheduled";
                  return (
                    <section className="review-card" key={destination.key}>
                      <div className="destination-card-title"><PlatformIcon platform={destination.platform} iconOnly /><strong>{platformDataMap[destination.platform].name} · {destination.contentType}</strong></div>
                      {activeMedia && <div className="review-media">{activeMedia.type === "image" ? <img src={activeMedia.url} alt="" /> : <video src={activeMedia.url} preload="metadata" />}</div>}
                      <p>{previewText(destination)}</p>
                      <dl><div><dt>Date</dt><dd>{destination.date}</dd></div><div><dt>Time</dt><dd>{destination.time}</dd></div><div><dt>Action</dt><dd>{destinationActionLabel(action)}</dd></div></dl>
                    </section>
                  );
                })}
              </div>
            </div>
          )}

          {step === "results" && (
            <div>
              <h4>{processing ? "Processing destinations" : "Create Post complete"}</h4>
              <div className="result-summary"><strong>Successful: {successful}</strong><strong>Failed: {failed}</strong></div>
              <div className="create-results">
                {results.map((result) => {
                  const destination = destinations.find((item) => item.key === result.destinationKey)!;
                  return (
                    <div className={`create-result ${result.state}`} key={result.destinationKey}>
                      <PlatformIcon platform={destination.platform} iconOnly />
                      <div><strong>{platformDataMap[destination.platform].name} · {destination.contentType}</strong><span>{result.message}</span>{result.error && <small>{result.error}</small>}{result.postId && <small>Planner post: {result.postId}</small>}</div>
                      <span className="result-state">{result.state === "processing" ? "…" : result.state === "success" ? "✓" : result.state === "failed" ? "!" : "·"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <footer className="panel-actions create-actions">
          <div>
            {step !== "content" && step !== "results" && <button type="button" className="btn-secondary" onClick={() => setStep(STEPS[currentStepIndex - 1].key)}>Back</button>}
          </div>
          <div className="right">
            {step !== "results" && <button type="button" className="btn-secondary" onClick={onClose} disabled={processing}>Cancel</button>}
            {step === "content" && <button type="button" className="btn-primary" onClick={goToPlatforms} disabled={uploading || validatingUrl}>Next</button>}
            {step === "platforms" && <button type="button" className="btn-primary" onClick={goToDetails} disabled={!selectedKeys.length}>Next</button>}
            {step === "details" && <button type="button" className="btn-primary" onClick={goToReview}>Review</button>}
            {step === "review" && <button type="button" className="btn-primary" onClick={processDestinations} disabled={conflicts.length > 0}>Confirm and process</button>}
            {step === "results" && !processing && <button type="button" className="btn-primary" onClick={onClose}>Close</button>}
          </div>
        </footer>
      </section>
    </div>
  );
};
