import React, { useCallback, useMemo, useState } from "react";
import { CONTENT_TYPES, FIELD_SCHEMA, getContentTypeCapability, isPublishingPlatform } from "../../lib/contentTypes";
import { buildScheduledAt, parseImportedPosts, validatePost } from "../../lib/validation";
import { usePostContext } from "../../context/PostContext";
import { useToast } from "../common/Toast";
import { PlatformIcon, platformDataMap } from "../common/PlatformIcon";
import type { Platform, Post } from "../../types/post";

const SUPPORTED_PLATFORMS: Platform[] = ["ig", "th", "fb", "yt"];
const MAX_ITEMS = 10;
const PRESET_STORAGE_KEY = "social-planner:scheduling-presets:v1";

type ReuseDraft = {
  key: string;
  platform: Platform;
  contentType: string;
  title: string;
  topic: string;
  content: string;
  description: string;
  caption: string;
  mediaUrl: string;
  date: string;
  time: string;
};

type PresetSlot = { platform: Platform; time: string; dayOffset: number };
type SchedulingPreset = { id: string; name: string; slots: PresetSlot[]; builtIn?: boolean };

interface ReuseSchedulerModalProps {
  sourcePost: Post | null;
  onClose: () => void;
}

const BUILT_IN_PRESETS: SchedulingPreset[] = [
  {
    id: "same-day-launch",
    name: "Same-day cross-platform",
    builtIn: true,
    slots: SUPPORTED_PLATFORMS.map((platform) => ({ platform, time: "10:00", dayOffset: 0 })),
  },
  {
    id: "staggered-launch",
    name: "Four-day stagger",
    builtIn: true,
    slots: SUPPORTED_PLATFORMS.map((platform, dayOffset) => ({ platform, time: "10:00", dayOffset })),
  },
];

function localDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function addDays(date: string, offset: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + offset);
  return localDate(value);
}

function dayDifference(date: string, baseDate: string): number {
  const current = new Date(`${date}T12:00:00`).getTime();
  const base = new Date(`${baseDate}T12:00:00`).getTime();
  return Math.round((current - base) / 86400000);
}

function sourceText(source?: Partial<Post> | ReuseDraft | null): string {
  return source?.caption || source?.content || source?.description || source?.title || source?.topic || "";
}

function makeDraft(source?: Partial<Post> | ReuseDraft | null, targetPlatform?: Platform, date?: string): ReuseDraft {
  const platform = SUPPORTED_PLATFORMS.includes(targetPlatform || source?.platform as Platform)
    ? (targetPlatform || source?.platform) as Platform
    : "ig";
  const text = sourceText(source);
  const samePlatform = source?.platform === platform;
  return {
    key: crypto.randomUUID(),
    platform,
    contentType: samePlatform && source?.contentType && isPublishingPlatform(platform)
      ? getContentTypeCapability(platform, source.contentType)?.name || source.contentType
      : CONTENT_TYPES[platform][0],
    title: platform === "yt" ? (source?.title || source?.topic || text.slice(0, 100)) : (samePlatform ? source?.title || "" : ""),
    topic: platform === "ig" || platform === "fb" || platform === "th" ? (source?.topic || source?.title || "") : "",
    content: platform === "fb" || platform === "th" ? text : (samePlatform ? source?.content || "" : ""),
    description: platform === "yt" ? (source?.description || text) : (samePlatform ? source?.description || "" : ""),
    caption: platform === "ig" ? text : (samePlatform ? source?.caption || "" : ""),
    mediaUrl: source?.mediaUrl || "",
    date: date || source?.date || localDate(),
    time: source?.time || "10:00",
  };
}

function loadPresets(): SchedulingPreset[] {
  try {
    const value = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((preset) => preset?.id && preset?.name && Array.isArray(preset?.slots)) : [];
  } catch {
    return [];
  }
}

function editablePayload(draft: ReuseDraft): Omit<Post, "id" | "createdAt" | "updatedAt"> {
  return {
    platform: draft.platform,
    contentType: draft.contentType,
    title: draft.title || undefined,
    topic: draft.topic || undefined,
    content: draft.content || undefined,
    description: draft.description || undefined,
    caption: draft.caption || undefined,
    mediaUrl: draft.mediaUrl || null,
    date: draft.date,
    time: draft.time,
    scheduledAt: buildScheduledAt(draft.date, draft.time),
    status: "scheduled",
  };
}

export const ReuseSchedulerModal: React.FC<ReuseSchedulerModalProps> = ({ sourcePost, onClose }) => {
  const { bulkAddPosts } = usePostContext();
  const { showToast } = useToast();
  const [drafts, setDrafts] = useState<ReuseDraft[]>([makeDraft(sourcePost)]);
  const [step, setStep] = useState<"edit" | "preview">("edit");
  const [activeTool, setActiveTool] = useState<"manual" | "json" | "presets">("manual");
  const [jsonText, setJsonText] = useState("");
  const [jsonErrors, setJsonErrors] = useState<string[]>([]);
  const [jsonWarnings, setJsonWarnings] = useState<string[]>([]);
  const [presets, setPresets] = useState<SchedulingPreset[]>(loadPresets);
  const [presetName, setPresetName] = useState("");
  const [presetBaseDate, setPresetBaseDate] = useState(localDate());
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const template = drafts[0] || makeDraft(sourcePost);

  const updateDraft = useCallback((key: string, changes: Partial<ReuseDraft>) => {
    setDrafts((items) => items.map((item) => item.key === key ? { ...item, ...changes } : item));
    setValidationErrors([]);
  }, []);

  const changePlatform = useCallback((draft: ReuseDraft, platform: Platform) => {
    const adapted = makeDraft(draft, platform, draft.date);
    updateDraft(draft.key, { ...adapted, key: draft.key, time: draft.time, mediaUrl: draft.mediaUrl });
  }, [updateDraft]);

  const addItem = useCallback(() => {
    if (drafts.length >= MAX_ITEMS) return;
    setDrafts((items) => [...items, makeDraft(items[0] || sourcePost, items[0]?.platform, items[0]?.date)]);
  }, [drafts.length, sourcePost]);

  const validateDrafts = useCallback((): string[] => {
    const errors: string[] = [];
    if (!drafts.length) errors.push("Add at least one post.");
    if (drafts.length > MAX_ITEMS) errors.push(`A scheduling operation can contain at most ${MAX_ITEMS} posts.`);
    drafts.forEach((draft, index) => {
      const result = validatePost(editablePayload(draft));
      result.errors.forEach((error) => errors.push(`Post ${index + 1}: ${error}`));
      if (!draft.time) errors.push(`Post ${index + 1}: time is required.`);
      if (!buildScheduledAt(draft.date, draft.time)) errors.push(`Post ${index + 1}: date and time are invalid.`);
      if (draft.mediaUrl) {
        try {
          const url = new URL(draft.mediaUrl);
          if (!/^https?:$/.test(url.protocol)) throw new Error();
        } catch {
          errors.push(`Post ${index + 1}: media URL must be an HTTP or HTTPS URL.`);
        }
      }
    });
    return errors;
  }, [drafts]);

  const review = useCallback(() => {
    const errors = validateDrafts();
    setValidationErrors(errors);
    if (!errors.length) setStep("preview");
  }, [validateDrafts]);

  const confirm = useCallback(async () => {
    const errors = validateDrafts();
    if (errors.length) {
      setValidationErrors(errors);
      setStep("edit");
      return;
    }
    setSaving(true);
    const created = await bulkAddPosts(drafts.map(editablePayload));
    setSaving(false);
    if (created.length === drafts.length) {
      showToast("Schedule created", `${created.length} independent post${created.length === 1 ? "" : "s"} added.`, "success");
      onClose();
    } else {
      showToast("Schedule not saved", "The posts could not all be created. Review the error and try again.", "error");
    }
  }, [bulkAddPosts, drafts, onClose, showToast, validateDrafts]);

  const loadJson = useCallback(() => {
    const result = parseImportedPosts(jsonText);
    const errors = [...result.errors];
    if (result.items.length > MAX_ITEMS) errors.push(`JSON contains ${result.items.length} posts; the maximum is ${MAX_ITEMS}.`);
    result.items.forEach((post, index) => {
      if (!SUPPORTED_PLATFORMS.includes(post.platform)) errors.push(`Row ${index + 1}: Phase 5 supports Instagram, Threads, Facebook and YouTube only.`);
    });
    setJsonErrors(errors);
    setJsonWarnings(result.warnings);
    if (errors.length) return;
    setDrafts(result.items.map((post) => makeDraft({
      platform: post.platform,
      contentType: post.contentType,
      title: post.title,
      topic: post.topic,
      content: post.content,
      description: post.description,
      caption: post.caption,
      mediaUrl: post.mediaUrl,
      date: post.date,
      time: post.time || "10:00",
    })));
    setActiveTool("manual");
    setStep("edit");
    showToast("JSON loaded", `${result.items.length} post${result.items.length === 1 ? "" : "s"} loaded for editing.`, "success");
  }, [jsonText, showToast]);

  const savePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name || !drafts.length) return;
    const baseDate = drafts[0].date;
    const preset: SchedulingPreset = {
      id: `preset_${Date.now()}`,
      name,
      slots: drafts.map((draft) => ({ platform: draft.platform, time: draft.time, dayOffset: dayDifference(draft.date, baseDate) })),
    };
    const next = [...presets, preset];
    setPresets(next);
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next));
    setPresetName("");
    showToast("Preset saved", `${name} is available for future schedules.`, "success");
  }, [drafts, presetName, presets, showToast]);

  const applyPreset = useCallback((preset: SchedulingPreset) => {
    const source = sourcePost || template;
    setDrafts(preset.slots.slice(0, MAX_ITEMS).map((slot) => {
      const draft = makeDraft(source, slot.platform, addDays(presetBaseDate, slot.dayOffset));
      return { ...draft, time: slot.time || "10:00" };
    }));
    setActiveTool("manual");
    setStep("edit");
    setValidationErrors([]);
  }, [presetBaseDate, sourcePost, template]);

  const deletePreset = useCallback((id: string) => {
    const next = presets.filter((preset) => preset.id !== id);
    setPresets(next);
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next));
  }, [presets]);

  const previewRows = useMemo(() => drafts.map((draft, index) => ({
    ...draft,
    index: index + 1,
    text: draft.title || draft.caption || draft.content || draft.description || draft.topic || "—",
  })), [drafts]);

  return (
    <div className="overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="panel reuse-panel" role="dialog" aria-modal="true" aria-label="Reuse and schedule content">
        <h3>Reuse &amp; Schedule</h3>
        <p className="sub">
          {sourcePost ? "Create independent posts from this content. The original and its publishing history stay unchanged." : "Prepare up to 10 independent posts, then review them before saving."}
        </p>

        {step === "edit" ? (
          <>
            <div className="reuse-tabs">
              <button type="button" className={activeTool === "manual" ? "active" : ""} onClick={() => setActiveTool("manual")}>Manual</button>
              <button type="button" className={activeTool === "json" ? "active" : ""} onClick={() => setActiveTool("json")}>JSON</button>
              <button type="button" className={activeTool === "presets" ? "active" : ""} onClick={() => setActiveTool("presets")}>Presets</button>
            </div>

            {activeTool === "json" && (
              <div className="reuse-tool">
                <label>Scheduling JSON</label>
                <textarea className="json-code" value={jsonText} onChange={(event) => setJsonText(event.target.value)} placeholder='[{"platform":"ig","contentType":"Post","caption":"...","mediaUrl":"https://...","date":"2026-10-01","time":"10:00"}]' />
                <button type="button" className="btn-secondary" onClick={loadJson} disabled={!jsonText.trim()}>Validate &amp; load for editing</button>
                {!!jsonErrors.length && <div className="bulk-errors">{jsonErrors.map((error, index) => <div className="error" key={index}>{error}</div>)}</div>}
                {!!jsonWarnings.length && <div className="bulk-errors reuse-warnings">{jsonWarnings.map((warning, index) => <div className="error" key={index}>{warning}</div>)}</div>}
              </div>
            )}

            {activeTool === "presets" && (
              <div className="reuse-tool">
                <label>Schedule starts</label>
                <input type="date" value={presetBaseDate} onChange={(event) => setPresetBaseDate(event.target.value)} />
                <div className="preset-list">
                  {[...BUILT_IN_PRESETS, ...presets].map((preset) => (
                    <div className="preset-row" key={preset.id}>
                      <div><strong>{preset.name}</strong><span>{preset.slots.length} post{preset.slots.length === 1 ? "" : "s"}</span></div>
                      <button type="button" className="btn-secondary btn-mini" onClick={() => applyPreset(preset)}>Apply</button>
                      {!preset.builtIn && <button type="button" className="btn-danger btn-mini" onClick={() => deletePreset(preset.id)}>Delete</button>}
                    </div>
                  ))}
                </div>
                <label>Save current schedule as a preset</label>
                <div className="preset-save">
                  <input type="text" value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Preset name" />
                  <button type="button" className="btn-secondary" onClick={savePreset} disabled={!presetName.trim()}>Save preset</button>
                </div>
              </div>
            )}

            {activeTool === "manual" && (
              <>
                <div className="reuse-count">{drafts.length} of {MAX_ITEMS} posts</div>
                <div className="reuse-items">
                  {drafts.map((draft, index) => {
                    const fields = FIELD_SCHEMA[draft.platform];
                    return (
                      <section className="reuse-item" key={draft.key}>
                        <div className="reuse-item-head">
                          <strong>Post {index + 1}</strong>
                          {drafts.length > 1 && <button type="button" className="btn-danger btn-mini" onClick={() => setDrafts((items) => items.filter((item) => item.key !== draft.key))}>Remove</button>}
                        </div>
                        <div className="reuse-form-grid">
                          <div className="reuse-span-2">
                            <label>Platform</label>
                            <div className="platform-picker">
                              {SUPPORTED_PLATFORMS.map((platform) => <button key={platform} type="button" className={`platform-pick-btn${draft.platform === platform ? " active" : ""}`} onClick={() => changePlatform(draft, platform)}><PlatformIcon platform={platform} iconOnly /> {platformDataMap[platform].name}</button>)}
                            </div>
                          </div>
                          {fields.map((field) => (
                            <div className={field.type === "textarea" ? "reuse-span-2" : ""} key={field.key}>
                              <label>{field.label}</label>
                              {field.type === "select" ? (
                                <select value={draft.contentType} onChange={(event) => updateDraft(draft.key, { contentType: event.target.value })}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>
                              ) : field.type === "textarea" ? (
                                <textarea value={String(draft[field.key as keyof ReuseDraft] || "")} onChange={(event) => updateDraft(draft.key, { [field.key]: event.target.value })} />
                              ) : (
                                <input type="text" value={String(draft[field.key as keyof ReuseDraft] || "")} onChange={(event) => updateDraft(draft.key, { [field.key]: event.target.value })} />
                              )}
                            </div>
                          ))}
                          <div className="reuse-span-2"><label>Media URL</label><input type="text" value={draft.mediaUrl} onChange={(event) => updateDraft(draft.key, { mediaUrl: event.target.value })} placeholder="https://..." /></div>
                          <div><label>Date</label><input type="date" value={draft.date} onChange={(event) => updateDraft(draft.key, { date: event.target.value })} /></div>
                          <div><label>Time</label><input type="time" value={draft.time} onChange={(event) => updateDraft(draft.key, { time: event.target.value })} /></div>
                        </div>
                      </section>
                    );
                  })}
                </div>
                <button type="button" className="btn-secondary" onClick={addItem} disabled={drafts.length >= MAX_ITEMS}>Add another post</button>
              </>
            )}

            {!!validationErrors.length && <div className="bulk-errors">{validationErrors.map((error, index) => <div className="error" key={index}>{error}</div>)}</div>}
            <div className="panel-actions"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><div className="right"><button type="button" className="btn-primary" onClick={review}>Review schedule</button></div></div>
          </>
        ) : (
          <>
            <div className="bulk-ok"><strong>{drafts.length} post{drafts.length === 1 ? "" : "s"} ready.</strong> Nothing is saved until you confirm.</div>
            <div className="reuse-preview-list">
              {previewRows.map((draft) => (
                <div className="reuse-preview" key={draft.key}>
                  <PlatformIcon platform={draft.platform} iconOnly />
                  <div><strong>{platformDataMap[draft.platform].name} · {draft.contentType}</strong><span>{draft.date} at {draft.time}</span><p>{draft.text}</p>{draft.mediaUrl && <small>Uses source media URL</small>}</div>
                  <button type="button" className="btn-secondary btn-mini" onClick={() => setStep("edit")}>Edit</button>
                </div>
              ))}
            </div>
            <div className="panel-actions"><button type="button" className="btn-secondary" onClick={() => setStep("edit")}>Back to edit</button><div className="right"><button type="button" className="btn-primary" onClick={confirm} disabled={saving}>{saving ? "Saving…" : `Confirm ${drafts.length} post${drafts.length === 1 ? "" : "s"}`}</button></div></div>
          </>
        )}
      </div>
    </div>
  );
};
