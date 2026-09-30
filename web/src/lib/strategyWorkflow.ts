import {
  getContentTypeCapability,
  isPublishingPlatform,
  PLATFORM_CAPABILITIES,
  type PublishingPlatform,
  type RequiredMediaType,
} from "./contentTypes";

export const STRATEGY_SCHEMA_VERSION = 1;
export const STRATEGY_STORAGE_KEY = "social-planner:strategies:v1";
export const MAX_STRATEGY_DESTINATIONS = 10;

export type StrategySlotType = Exclude<RequiredMediaType, "none"> | "text";

export interface StrategyRule {
  id: string;
  slotName: string;
  platform: PublishingPlatform;
  contentType: string;
  dayOffset: number;
  time: string;
}

export interface PublishingStrategy {
  id: string;
  name: string;
  rules: StrategyRule[];
  createdAt: string;
  updatedAt: string;
}

interface StrategyStore {
  schemaVersion: 1;
  strategies: PublishingStrategy[];
}

export interface StrategySlotDefinition {
  name: string;
  type: StrategySlotType;
  ruleCount: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function slotTypeForRule(rule: Pick<StrategyRule, "platform" | "contentType">): StrategySlotType | null {
  const capability = getContentTypeCapability(rule.platform, rule.contentType);
  if (!capability) return null;
  return capability.mediaType === "none" ? "text" : capability.mediaType;
}

export function validateStrategy(name: string, rules: StrategyRule[]): string[] {
  const errors: string[] = [];
  if (!name.trim()) errors.push("Strategy name is required.");
  if (!rules.length) errors.push("Add at least one destination rule.");
  if (rules.length > MAX_STRATEGY_DESTINATIONS) errors.push(`A strategy can contain at most ${MAX_STRATEGY_DESTINATIONS} destination rules.`);
  const slotTypes = new Map<string, StrategySlotType>();

  rules.forEach((rule, index) => {
    const label = `Rule ${index + 1}`;
    const slotName = rule.slotName.trim();
    if (!slotName) errors.push(`${label}: slot name is required.`);
    if (!isPublishingPlatform(rule.platform)) {
      errors.push(`${label}: platform is unsupported.`);
      return;
    }
    const type = getContentTypeCapability(rule.platform, rule.contentType);
    if (!type) {
      errors.push(`${label}: content type is unsupported for ${PLATFORM_CAPABILITIES[rule.platform].name}.`);
      return;
    }
    if (!Number.isInteger(rule.dayOffset) || rule.dayOffset < 0) {
      errors.push(`${label}: day offset must be a non-negative whole number.`);
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.time)) errors.push(`${label}: time must use 24-hour HH:MM format.`);
    if (slotName) {
      const required = type.mediaType === "none" ? "text" : type.mediaType;
      const existing = slotTypes.get(slotName.toLowerCase());
      if (existing && existing !== required) {
        errors.push(`${label}: slot "${slotName}" cannot be both ${existing} and ${required}.`);
      } else {
        slotTypes.set(slotName.toLowerCase(), required);
      }
    }
  });
  return Array.from(new Set(errors));
}

export function deriveStrategySlots(rules: StrategyRule[]): StrategySlotDefinition[] {
  const slots = new Map<string, StrategySlotDefinition>();
  rules.forEach((rule) => {
    const name = rule.slotName.trim();
    const type = slotTypeForRule(rule);
    if (!name || !type) return;
    const key = name.toLowerCase();
    const existing = slots.get(key);
    if (existing) existing.ruleCount += 1;
    else slots.set(key, { name, type, ruleCount: 1 });
  });
  return Array.from(slots.values());
}

function validStoredStrategy(value: unknown): value is PublishingStrategy {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.name !== "string" || !Array.isArray(value.rules)) return false;
  return value.rules.every((rule) => {
    if (!isObject(rule)) return false;
    return typeof rule.id === "string" && typeof rule.slotName === "string" && typeof rule.platform === "string"
      && typeof rule.contentType === "string" && typeof rule.dayOffset === "number" && typeof rule.time === "string";
  });
}

export function loadStrategies(): PublishingStrategy[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STRATEGY_STORAGE_KEY) || "null");
    if (!isObject(parsed) || parsed.schemaVersion !== STRATEGY_SCHEMA_VERSION || !Array.isArray(parsed.strategies)) return [];
    return parsed.strategies.filter(validStoredStrategy).filter((strategy) => validateStrategy(strategy.name, strategy.rules).length === 0);
  } catch {
    return [];
  }
}

export function saveStrategies(strategies: PublishingStrategy[]): void {
  const value: StrategyStore = { schemaVersion: STRATEGY_SCHEMA_VERSION, strategies };
  localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify(value));
}

export function addDaysToLocalDate(date: string, offset: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(year, month - 1, day + offset, 12, 0, 0);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
