export interface WorkflowStep {
  step: number;
  title: string;
  description: string;
}

export const workflowSteps: WorkflowStep[] = [
  {
    step: 1,
    title: "Open the extension",
    description:
      "Click the toolbar icon to land on the Home screen. No separate login — it uses the browser tabs you're already signed into for Basecamp, EasySpeak, and Club Central.",
  },
  {
    step: 2,
    title: "Sync your data",
    description: "Import from each source with one click. Every extraction runs in the background.",
  },
  {
    step: 3,
    title: "Work from the Home screen",
    description:
      "Open the Club Progress Report, the Pathways Onboarding Helper, or the Excel export straight from the feature tiles.",
  },
  {
    step: 4,
    title: "Act on what the report surfaces",
    description:
      "Follow up with members close to their next level, and help members who haven't started a path get enrolled.",
  },
];
