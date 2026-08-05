export interface WorkflowStep {
  step: number;
  title: string;
  description: string;
}

export const workflowSteps: WorkflowStep[] = [
  {
    step: 1,
    title: "Open the extension",
    description: "Click the toolbar icon. No separate login — it uses the browser tabs you're already signed into.",
  },
  {
    step: 2,
    title: "Generate report",
    description: "Extract Basecamp data and EasySpeak data with one click each. Both run in the background.",
  },
  {
    step: 3,
    title: "Review progress dashboard",
    description: "See every club, member, and path in one place, with mismatches and unmatched records called out.",
  },
  {
    step: 4,
    title: "Act on next-level recommendations",
    description: "Follow up with members who are close to their next level while the moment is still relevant.",
  },
];
