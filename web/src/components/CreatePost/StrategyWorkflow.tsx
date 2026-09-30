import React, { useMemo, useState } from "react";
import type { AddPostDetailedResult, NewPost } from "../../context/PostContext";
import type { Post } from "../../types/post";
import {
  PLATFORM_CAPABILITIES,
  getContentTypeCapability,
  type PublishingPlatform,
} from "../../lib/contentTypes";
import {
  destinationAction,
  destinationActionLabel,
  destinationToPost,
  findDuplicateConflictsForCandidates,
  sanitizeProcessError,
  validateDestination,
  validateRemoteMediaUrl,
  type CreateMediaSource,
  type DestinationDraft,
  type DestinationProcessResult,
} from "../../lib/createPostWorkflow";
import {
  addDaysToLocalDate,
  deriveStrategySlots,
  loadStrategies,
  MAX_STRATEGY_DESTINATIONS,
  saveStrategies,
  validateStrategy,
  type PublishingStrategy,
  type StrategyRule,
  type StrategySlotDefinition,
} from "../../lib/strategyWorkflow";
import { getSupportedTypes, isImageFile, isVideoFile, uploadMediaFile, validateMediaFile } from "../../lib/cloudinary";
import { PlatformIcon, platformDataMap } from "../common/PlatformIcon";
import { CreateWorkflowTabs, type CreateWorkflowMode } from "./CreateWorkflowTabs";

interface StrategyWorkflowProps {
  posts: Post[];
  onCreate: (post: NewPost) => Promise<AddPostDetailedResult>;
  onClose: () => void;
  onModeChange: (mode: CreateWorkflowMode) => void;
  onProcessingChange?: (processing: boolean) => void;
}

type Step = "strategy" | "slots" | "metadata" | "review" | "results";
type SlotMode = "upload" | "url";
interface SlotValue {
  definition: StrategySlotDefinition;
  mode: SlotMode;
  text: string;
  urlInput: string;
  media: CreateMediaSource | null;
  busy: boolean;
  error: string;
}
interface GeneratedDestination extends DestinationDraft {
  ruleId: string;
  slotName: string;
}

const PLATFORMS = Object.keys(PLATFORM_CAPABILITIES) as PublishingPlatform[];
const todayLocal = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const validLocalDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
};
const newRule = (): StrategyRule => ({ id: crypto.randomUUID(), slotName: "MainImage", platform: "ig", contentType: "Image", dayOffset: 0, time: "10:00" });
const slotKey = (name: string) => name.trim().toLowerCase();
const previewText = (destination: DestinationDraft) => destination.title || destination.caption || destination.content || destination.description || "—";

function metadataFields(platform: PublishingPlatform): Array<"title" | "caption" | "content" | "description"> {
  if (platform === "ig") return ["caption"];
  if (platform === "th" || platform === "fb") return ["content"];
  return ["title", "description"];
}

export const StrategyWorkflow: React.FC<StrategyWorkflowProps> = ({ posts, onCreate, onClose, onModeChange, onProcessingChange }) => {
  const [strategies, setStrategies] = useState<PublishingStrategy[]>(loadStrategies);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [strategyName, setStrategyName] = useState("");
  const [rules, setRules] = useState<StrategyRule[]>([newRule()]);
  const [strategyErrors, setStrategyErrors] = useState<string[]>([]);
  const [activeStrategy, setActiveStrategy] = useState<PublishingStrategy | null>(null);
  const [step, setStep] = useState<Step>("strategy");
  const [baseDate, setBaseDate] = useState(todayLocal());
  const [slots, setSlots] = useState<Record<string, SlotValue>>({});
  const [slotErrors, setSlotErrors] = useState<string[]>([]);
  const [destinations, setDestinations] = useState<GeneratedDestination[]>([]);
  const [metadataJson, setMetadataJson] = useState("");
  const [metadataErrors, setMetadataErrors] = useState<string[]>([]);
  const [metadataNotice, setMetadataNotice] = useState("");
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<DestinationProcessResult[]>([]);

  const persist = (next: PublishingStrategy[]) => {
    setStrategies(next);
    saveStrategies(next);
  };

  const resetEditor = () => {
    setEditingId(null);
    setStrategyName("");
    setRules([newRule()]);
    setStrategyErrors([]);
  };

  const saveStrategy = () => {
    const normalizedRules = rules.map((rule) => ({ ...rule, slotName: rule.slotName.trim(), contentType: getContentTypeCapability(rule.platform, rule.contentType)?.name || rule.contentType }));
    const errors = validateStrategy(strategyName, normalizedRules);
    setStrategyErrors(errors);
    if (errors.length) return;
    const now = new Date().toISOString();
    if (editingId) {
      persist(strategies.map((strategy) => strategy.id === editingId
        ? { ...strategy, name: strategyName.trim(), rules: normalizedRules, updatedAt: now }
        : strategy));
    } else {
      persist([...strategies, { id: crypto.randomUUID(), name: strategyName.trim(), rules: normalizedRules, createdAt: now, updatedAt: now }]);
    }
    resetEditor();
  };

  const editStrategy = (strategy: PublishingStrategy) => {
    setEditingId(strategy.id);
    setStrategyName(strategy.name);
    setRules(strategy.rules.map((rule) => ({ ...rule })));
    setStrategyErrors([]);
  };

  const deleteStrategy = (strategy: PublishingStrategy) => {
    if (!window.confirm(`Delete strategy "${strategy.name}"?`)) return;
    persist(strategies.filter((item) => item.id !== strategy.id));
    if (editingId === strategy.id) resetEditor();
  };

  const useStrategy = (strategy: PublishingStrategy) => {
    const definitions = deriveStrategySlots(strategy.rules);
    const nextSlots: Record<string, SlotValue> = {};
    definitions.forEach((definition) => {
      nextSlots[slotKey(definition.name)] = { definition, mode: "upload", text: "", urlInput: "", media: null, busy: false, error: "" };
    });
    setActiveStrategy(strategy);
    setBaseDate(todayLocal());
    setSlots(nextSlots);
    setSlotErrors([]);
    setDestinations([]);
    setMetadataJson("");
    setMetadataErrors([]);
    setMetadataNotice("");
    setResults([]);
    setStep("slots");
  };

  const updateSlot = (key: string, changes: Partial<SlotValue>) => setSlots((current) => ({ ...current, [key]: { ...current[key], ...changes } }));

  const uploadSlotFile = async (key: string, file?: File) => {
    if (!file) return;
    const slot = slots[key];
    const validation = validateMediaFile(file);
    if (!validation.valid) return updateSlot(key, { media: null, error: validation.error || "Invalid media file." });
    const detected = isImageFile(file) ? "image" : isVideoFile(file) ? "video" : null;
    if (detected !== slot.definition.type) return updateSlot(key, { media: null, error: `${slot.definition.name} requires ${slot.definition.type} media.` });
    updateSlot(key, { busy: true, error: "" });
    try {
      const uploaded = await uploadMediaFile(file, { folder: "social_planner" });
      updateSlot(key, { busy: false, media: { url: uploaded.secure_url, publicId: uploaded.public_id, bytes: uploaded.bytes, identity: uploaded.secure_url, type: detected, origin: "upload" }, urlInput: uploaded.secure_url });
    } catch (error) {
      updateSlot(key, { busy: false, media: null, error: sanitizeProcessError(error) });
    }
  };

  const validateSlotUrl = async (key: string) => {
    const slot = slots[key];
    updateSlot(key, { busy: true, media: null, error: "" });
    try {
      const media = await validateRemoteMediaUrl(slot.urlInput);
      if (media.type !== slot.definition.type) throw new Error(`${slot.definition.name} requires ${slot.definition.type} media, but the URL contains ${media.type}.`);
      updateSlot(key, { busy: false, media });
    } catch (error) {
      updateSlot(key, { busy: false, media: null, error: sanitizeProcessError(error) });
    }
  };

  const generateDestinations = () => {
    if (!activeStrategy) return;
    const errors: string[] = [];
    if (!validLocalDate(baseDate)) errors.push("Choose a valid base date.");
    Object.values(slots).forEach((slot) => {
      if (slot.definition.type === "text" && !slot.text.trim()) errors.push(`${slot.definition.name}: text is required.`);
      if (slot.definition.type !== "text" && !slot.media) errors.push(`${slot.definition.name}: validate or upload ${slot.definition.type} media.`);
      if (slot.busy) errors.push(`${slot.definition.name}: media validation is still in progress.`);
    });
    setSlotErrors(errors);
    if (errors.length) return;

    setDestinations(activeStrategy.rules.map((rule) => {
      const previous = destinations.find((destination) => destination.ruleId === rule.id);
      const type = getContentTypeCapability(rule.platform, rule.contentType)!;
      const slot = slots[slotKey(rule.slotName)];
      return {
        key: `strategy-rule-${rule.id}`,
        ruleId: rule.id,
        slotName: rule.slotName,
        platform: rule.platform,
        contentType: type.name,
        mediaType: type.mediaType,
        title: previous?.title || "",
        caption: previous?.caption || "",
        content: slot.definition.type === "text" ? slot.text.trim() : previous?.content || "",
        description: previous?.description || "",
        date: addDaysToLocalDate(baseDate, rule.dayOffset),
        time: rule.time,
      };
    }));
    setMetadataErrors([]);
    setMetadataNotice("");
    setStep("metadata");
  };

  const updateDestination = (key: string, changes: Partial<GeneratedDestination>) => {
    setDestinations((current) => current.map((destination) => destination.key === key ? { ...destination, ...changes } : destination));
  };

  const applyMetadataJson = () => {
    const errors: string[] = [];
    let parsed: unknown;
    try { parsed = JSON.parse(metadataJson); } catch (error) {
      setMetadataErrors([`Metadata JSON could not be parsed: ${error instanceof Error ? error.message : "Invalid JSON."}`]);
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return setMetadataErrors(["Metadata JSON root must be an object."]);
    const root = parsed as Record<string, unknown>;
    const unknownRoot = Object.keys(root).filter((key) => key !== "schemaVersion" && key !== "slots");
    if (unknownRoot.length) errors.push(`Unknown root field(s): ${unknownRoot.join(", ")}.`);
    if (root.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
    if (!root.slots || typeof root.slots !== "object" || Array.isArray(root.slots)) errors.push("slots must be an object.");
    const changes = new Map<string, Partial<GeneratedDestination>>();
    if (!errors.length) {
      Object.entries(root.slots as Record<string, unknown>).forEach(([slotName, rawSlot]) => {
        if (!slots[slotKey(slotName)]) { errors.push(`Unknown slot "${slotName}".`); return; }
        if (!rawSlot || typeof rawSlot !== "object" || Array.isArray(rawSlot)) { errors.push(`${slotName} must be an object.`); return; }
        const slotObject = rawSlot as Record<string, unknown>;
        if (Object.keys(slotObject).some((key) => key !== "destinations")) errors.push(`${slotName}: only destinations is supported.`);
        if (!Array.isArray(slotObject.destinations)) { errors.push(`${slotName}.destinations must be an array.`); return; }
        slotObject.destinations.forEach((rawEntry, index) => {
          const label = `${slotName}.destinations[${index}]`;
          if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) { errors.push(`${label} must be an object.`); return; }
          const entry = rawEntry as Record<string, unknown>;
          const allowed = new Set(["platform", "contentType", "dayOffset", "time", "title", "caption", "content", "description"]);
          const unknown = Object.keys(entry).filter((key) => !allowed.has(key));
          if (unknown.length) errors.push(`${label}: unknown field(s): ${unknown.join(", ")}.`);
          if (typeof entry.platform !== "string" || typeof entry.contentType !== "string" || typeof entry.dayOffset !== "number" || typeof entry.time !== "string") {
            errors.push(`${label}: platform, contentType, dayOffset and time are required.`); return;
          }
          const matches = activeStrategy?.rules.filter((rule) => slotKey(rule.slotName) === slotKey(slotName) && rule.platform === entry.platform
            && getContentTypeCapability(rule.platform, rule.contentType)?.name === getContentTypeCapability(rule.platform, entry.contentType as string)?.name
            && rule.dayOffset === entry.dayOffset && rule.time === entry.time) || [];
          if (matches.length !== 1) { errors.push(`${label}: destination match is ${matches.length ? "ambiguous" : "not in this strategy"}.`); return; }
          const destination = destinations.find((item) => item.ruleId === matches[0].id)!;
          const supported = new Set(metadataFields(destination.platform));
          const update: Partial<GeneratedDestination> = {};
          (["title", "caption", "content", "description"] as const).forEach((field) => {
            if (entry[field] === undefined) return;
            if (typeof entry[field] !== "string") errors.push(`${label}.${field} must be a string.`);
            else if (!supported.has(field)) errors.push(`${label}.${field} is unsupported for ${platformDataMap[destination.platform].name}.`);
            else update[field] = entry[field] as string;
          });
          changes.set(destination.key, update);
        });
      });
    }
    setMetadataErrors(errors);
    if (errors.length) { setMetadataNotice(""); return; }
    setDestinations((current) => current.map((destination) => ({ ...destination, ...(changes.get(destination.key) || {}) })));
    setMetadataNotice(`Populated metadata for ${changes.size} destination${changes.size === 1 ? "" : "s"}. Review and edit the fields below.`);
  };

  const validationRows = useMemo(() => destinations.map((destination) => {
    const media = slots[slotKey(destination.slotName)]?.media || null;
    const validation = validateDestination(destination, media);
    return { destination, media, validation, action: validation.scheduledAt ? destinationAction(destination, validation.scheduledAt) : undefined };
  }), [destinations, slots]);
  const conflicts = useMemo(() => findDuplicateConflictsForCandidates(
    destinations.map((destination) => ({ destination, mediaUrl: slots[slotKey(destination.slotName)]?.media?.url || null })), posts,
  ), [destinations, slots, posts]);
  const hasReviewErrors = validationRows.some((row) => row.validation.errors.length > 0) || conflicts.length > 0;

  const processDestinations = async () => {
    if (processing || hasReviewErrors) return;
    setProcessing(true);
    onProcessingChange?.(true);
    setStep("results");
    setResults(destinations.map((destination) => ({ destinationKey: destination.key, state: "queued", message: "Pending" })));
    for (const destination of destinations) {
      setResults((current) => current.map((result) => result.destinationKey === destination.key ? { ...result, state: "processing", message: "Creating planner record…" } : result));
      try {
        const media = slots[slotKey(destination.slotName)]?.media || null;
        const post = destinationToPost(destination, media);
        const outcome = await onCreate(post);
        if (outcome.nativeAttempted && !outcome.nativeSucceeded) {
          setResults((current) => current.map((result) => result.destinationKey === destination.key
            ? { ...result, state: "failed", message: "Planner record created; native submission failed", postId: outcome.post.id, error: sanitizeProcessError(outcome.error) } : result));
        } else {
          const action = destinationAction(destination, post.scheduledAt!);
          setResults((current) => current.map((result) => result.destinationKey === destination.key
            ? { ...result, state: "success", message: destinationActionLabel(action), postId: outcome.post.id } : result));
        }
      } catch (error) {
        setResults((current) => current.map((result) => result.destinationKey === destination.key
          ? { ...result, state: "failed", message: "Creation failed", error: sanitizeProcessError(error) } : result));
      }
    }
    setProcessing(false);
    onProcessingChange?.(false);
  };

  const successful = results.filter((result) => result.state === "success").length;
  const failed = results.filter((result) => result.state === "failed").length;

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !processing) onClose(); }}>
      <section className="panel create-workflow strategy-workflow" role="dialog" aria-modal="true" aria-labelledby="strategy-title">
        <header className="create-header"><div><h3 id="strategy-title">Create Post</h3><p className="sub">Build and use reusable destination strategies.</p></div><button type="button" className="cal-preview-close" onClick={onClose} disabled={processing}>×</button></header>
        <CreateWorkflowTabs active="strategy" onChange={onModeChange} disabled={processing} />
        <ol className="create-steps strategy-steps" aria-label="Strategy progress">{["Strategy", "Base date & slots", "Metadata", "Review", "Results"].map((label, index) => <li key={label} className={index === ["strategy", "slots", "metadata", "review", "results"].indexOf(step) ? "active" : ""}><span>{index + 1}</span>{label}</li>)}</ol>

        <div className="create-body strategy-body">
          {step === "strategy" && <div className="strategy-layout">
            <section><h4>Saved strategies</h4><p className="create-help">Strategies store destination rules only. Content is supplied each time they are used.</p><div className="strategy-list">{strategies.length === 0 && <div className="create-note">No strategies saved yet.</div>}{strategies.map((strategy) => <div className="strategy-list-row" key={strategy.id}><div><strong>{strategy.name}</strong><span>{strategy.rules.length} destination{strategy.rules.length === 1 ? "" : "s"} · {deriveStrategySlots(strategy.rules).length} slot{deriveStrategySlots(strategy.rules).length === 1 ? "" : "s"}</span></div><button type="button" className="btn-primary btn-mini" onClick={() => useStrategy(strategy)}>Use</button><button type="button" className="btn-secondary btn-mini" onClick={() => editStrategy(strategy)}>Edit</button><button type="button" className="btn-danger btn-mini" onClick={() => deleteStrategy(strategy)}>Delete</button></div>)}</div></section>
            <section className="strategy-editor"><h4>{editingId ? "Edit strategy" : "Create strategy"}</h4><label>Name</label><input type="text" value={strategyName} onChange={(event) => setStrategyName(event.target.value)} placeholder="Excel Reel Distribution" />
              <div className="strategy-rules">{rules.map((rule, index) => <div className="strategy-rule" key={rule.id}><div className="strategy-rule-head"><strong>Rule {index + 1}</strong>{rules.length > 1 && <button type="button" className="btn-danger btn-mini" onClick={() => setRules((current) => current.filter((item) => item.id !== rule.id))}>Remove</button>}</div><div className="strategy-rule-grid"><div><label>Slot name</label><input value={rule.slotName} onChange={(event) => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, slotName: event.target.value } : item))} /></div><div><label>Platform</label><select value={rule.platform} onChange={(event) => { const platform = event.target.value as PublishingPlatform; setRules((current) => current.map((item) => item.id === rule.id ? { ...item, platform, contentType: PLATFORM_CAPABILITIES[platform].contentTypes[0].name } : item)); }}><option value="ig">Instagram</option><option value="th">Threads</option><option value="fb">Facebook</option><option value="yt">YouTube</option></select></div><div><label>Content type</label><select value={rule.contentType} onChange={(event) => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, contentType: event.target.value } : item))}>{PLATFORM_CAPABILITIES[rule.platform].contentTypes.map((type) => <option key={type.name}>{type.name}</option>)}</select></div><div><label>Day offset</label><input type="number" min="0" value={rule.dayOffset} onChange={(event) => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, dayOffset: Number(event.target.value) } : item))} /></div><div><label>Time</label><input type="time" value={rule.time} onChange={(event) => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, time: event.target.value } : item))} /></div><div className="strategy-slot-type"><label>Required slot type</label><strong>{getContentTypeCapability(rule.platform, rule.contentType)?.mediaType === "none" ? "Text" : getContentTypeCapability(rule.platform, rule.contentType)?.mediaType}</strong></div></div></div>)}</div>
              <div className="strategy-editor-actions"><button type="button" className="btn-secondary" disabled={rules.length >= MAX_STRATEGY_DESTINATIONS} onClick={() => setRules((current) => [...current, newRule()])}>Add rule</button>{editingId && <button type="button" className="btn-secondary" onClick={resetEditor}>Cancel edit</button>}<button type="button" className="btn-primary" onClick={saveStrategy}>{editingId ? "Save changes" : "Save strategy"}</button></div>{strategyErrors.length > 0 && <ul className="create-errors">{strategyErrors.map((error) => <li key={error}>{error}</li>)}</ul>}</section>
          </div>}

          {step === "slots" && activeStrategy && <div><h4>{activeStrategy.name}</h4><p className="create-help">Choose a base date and supply every unique content slot. One upload is reused by all rules that reference that slot.</p><label>Base date</label><input type="date" value={baseDate} onChange={(event) => setBaseDate(event.target.value)} /><div className="strategy-slots">{Object.entries(slots).map(([key, slot]) => <section className="destination-card" key={key}><div className="destination-card-title"><strong>{slot.definition.name}</strong><span>{slot.definition.type} · {slot.definition.ruleCount} destination{slot.definition.ruleCount === 1 ? "" : "s"}</span></div>{slot.definition.type === "text" ? <textarea value={slot.text} onChange={(event) => updateSlot(key, { text: event.target.value, error: "" })} placeholder="Source text" /> : <><div className="create-mode-picker strategy-slot-modes"><button type="button" className={slot.mode === "upload" ? "active" : ""} onClick={() => updateSlot(key, { mode: "upload", media: null, error: "" })}>Upload once</button><button type="button" className={slot.mode === "url" ? "active" : ""} onClick={() => updateSlot(key, { mode: "url", media: null, error: "" })}>Public URL</button></div>{slot.mode === "upload" ? <input type="file" accept={getSupportedTypes().join(",")} disabled={slot.busy} onChange={(event) => uploadSlotFile(key, event.target.files?.[0])} /> : <div className="create-url-row"><input value={slot.urlInput} onChange={(event) => updateSlot(key, { urlInput: event.target.value, media: null, error: "" })} placeholder="https://…" /><button type="button" className="btn-secondary" disabled={slot.busy || !slot.urlInput.trim()} onClick={() => validateSlotUrl(key)}>{slot.busy ? "Checking…" : "Validate"}</button></div>}{slot.busy && <div className="create-upload-progress"><span /></div>}{slot.media && <div className="create-media-preview">{slot.media.type === "image" ? <img src={slot.media.url} alt="" /> : <video src={slot.media.url} preload="metadata" />}<div><strong>Validated {slot.media.type}</strong><span>{slot.media.origin === "upload" ? "Uploaded once to Cloudinary" : "Public URL"}</span></div></div>}</>}{slot.error && <div className="create-errors">{slot.error}</div>}</section>)}</div>{slotErrors.length > 0 && <ul className="create-errors">{slotErrors.map((error) => <li key={error}>{error}</li>)}</ul>}</div>}

          {step === "metadata" && <div><h4>Destination metadata</h4><p className="create-help">Each generated destination remains independently editable.</p><details className="strategy-metadata-import"><summary>Optional Metadata JSON autofill</summary><p>Match destinations by slot, platform, canonical content type, day offset, and time. Import only fills fields; it never creates posts.</p><textarea className="json-code" value={metadataJson} onChange={(event) => { setMetadataJson(event.target.value); setMetadataErrors([]); setMetadataNotice(""); }} placeholder={'{"schemaVersion":1,"slots":{"MainVideo":{"destinations":[{"platform":"ig","contentType":"Reel","dayOffset":0,"time":"09:30","caption":"..."}]}}}'} /><button type="button" className="btn-secondary" disabled={!metadataJson.trim()} onClick={applyMetadataJson}>Validate & apply metadata</button>{metadataNotice && <div className="bulk-ok">{metadataNotice}</div>}{metadataErrors.length > 0 && <ul className="create-errors">{metadataErrors.map((error) => <li key={error}>{error}</li>)}</ul>}</details><div className="destination-details">{destinations.map((destination) => <section className="destination-card" key={destination.key}><div className="destination-card-title"><PlatformIcon platform={destination.platform} iconOnly /><strong>{platformDataMap[destination.platform].name} · {destination.contentType}</strong><span>Slot: {destination.slotName}</span></div>{metadataFields(destination.platform).map((field) => <React.Fragment key={field}><label>{field.charAt(0).toUpperCase() + field.slice(1)}{field === "title" || (field === "content" && (destination.platform === "th" || destination.contentType === "Text")) ? " *" : ""}</label>{field === "title" ? <input value={destination[field]} onChange={(event) => updateDestination(destination.key, { [field]: event.target.value })} /> : <textarea value={destination[field]} onChange={(event) => updateDestination(destination.key, { [field]: event.target.value })} />}</React.Fragment>)}<div className="destination-schedule"><div><label>Date</label><input value={destination.date} readOnly /></div><div><label>Time</label><input value={destination.time} readOnly /></div></div></section>)}</div></div>}

          {step === "review" && <div><h4>Review generated posts</h4><p className="create-help">Nothing is submitted until confirmation.</p>{conflicts.length > 0 && <div className="create-conflicts"><strong>Duplicate conflicts must be resolved</strong>{conflicts.map((conflict) => { const destination = destinations.find((item) => item.key === conflict.destinationKey); return <div key={`${conflict.destinationKey}-${conflict.message}`}>{destination ? `${platformDataMap[destination.platform].name} ${destination.contentType} (${destination.slotName})` : "Destination"}: {conflict.source === "current operation" ? "duplicates another generated post for the same date." : conflict.message}</div>; })}</div>}<div className="strategy-review-grid">{validationRows.map(({ destination, media, validation, action }) => <section className="review-card strategy-review-card" key={destination.key}><div className="destination-card-title"><PlatformIcon platform={destination.platform} iconOnly /><strong>{platformDataMap[destination.platform].name} · {destination.contentType}</strong><span>{destination.slotName}</span></div>{media && <div className="review-media">{media.type === "image" ? <img src={media.url} alt="" /> : <video src={media.url} preload="metadata" />}</div>}<p>{previewText(destination)}</p><dl><div><dt>Date</dt><dd>{destination.date}</dd></div><div><dt>Time</dt><dd>{destination.time}</dd></div><div><dt>Action</dt><dd>{action ? destinationActionLabel(action) : "Invalid schedule"}</dd></div><div><dt>Validation</dt><dd>{validation.errors.length ? "Error" : "Ready"}</dd></div></dl>{validation.errors.length > 0 && <ul className="create-errors">{validation.errors.map((error) => <li key={error}>{error}</li>)}</ul>}</section>)}</div></div>}

          {step === "results" && <div><h4>{processing ? "Processing destinations" : "Strategy complete"}</h4><div className="result-summary"><strong>Successful: {successful}</strong><strong>Failed: {failed}</strong></div><div className="create-results">{results.map((result) => { const destination = destinations.find((item) => item.key === result.destinationKey)!; return <div className={`create-result ${result.state}`} key={result.destinationKey}><PlatformIcon platform={destination.platform} iconOnly /><div><strong>{platformDataMap[destination.platform].name} · {destination.contentType}</strong><span>{result.message}</span>{result.error && <small>{result.error}</small>}{result.postId && <small>Planner post: {result.postId}</small>}</div><span className="result-state">{result.state === "processing" ? "…" : result.state === "success" ? "✓" : result.state === "failed" ? "!" : "·"}</span></div>; })}</div></div>}
        </div>

        <footer className="panel-actions create-actions"><div>{step === "slots" && <button type="button" className="btn-secondary" onClick={() => setStep("strategy")}>Back</button>}{step === "metadata" && <button type="button" className="btn-secondary" onClick={() => setStep("slots")}>Back</button>}{step === "review" && <button type="button" className="btn-secondary" onClick={() => setStep("metadata")}>Edit metadata</button>}</div><div className="right">{step !== "results" && <button type="button" className="btn-secondary" onClick={onClose} disabled={processing}>Cancel</button>}{step === "slots" && <button type="button" className="btn-primary" onClick={generateDestinations}>Next</button>}{step === "metadata" && <button type="button" className="btn-primary" onClick={() => setStep("review")}>Review</button>}{step === "review" && <button type="button" className="btn-primary" disabled={hasReviewErrors} onClick={processDestinations}>Confirm and process</button>}{step === "results" && !processing && <button type="button" className="btn-primary" onClick={onClose}>Done</button>}</div></footer>
      </section>
    </div>
  );
};
