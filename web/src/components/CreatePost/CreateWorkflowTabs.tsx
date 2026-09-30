import React from "react";

export type CreateWorkflowMode = "single" | "json";

interface CreateWorkflowTabsProps {
  active: CreateWorkflowMode;
  onChange: (mode: CreateWorkflowMode) => void;
  disabled?: boolean;
}

export const CreateWorkflowTabs: React.FC<CreateWorkflowTabsProps> = ({ active, onChange, disabled = false }) => (
  <div className="create-workflow-tabs" role="tablist" aria-label="Create Post workflow">
    <button type="button" role="tab" aria-selected={active === "single"} className={active === "single" ? "active" : ""} onClick={() => onChange("single")} disabled={disabled}>Single</button>
    <button type="button" role="tab" aria-selected={active === "json"} className={active === "json" ? "active" : ""} onClick={() => onChange("json")} disabled={disabled}>JSON</button>
    <button type="button" role="tab" aria-selected={false} disabled title="Strategy creation is planned for a later stage">Strategy</button>
  </div>
);
