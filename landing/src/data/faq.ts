export interface FaqItem {
  question: string;
  answer: string;
}

export const faqItems: FaqItem[] = [
  {
    question: "Who is this for?",
    answer:
      "Toastmasters Vice Presidents of Education who track member Pathways progress across Basecamp and EasySpeak and want to stop reconciling the two by hand.",
  },
  {
    question: "Does this require EasySpeak API access?",
    answer:
      "No — EasySpeak has no public API. The extension reads the same pages you'd view yourself, using your existing logged-in session.",
  },
  {
    question: "Do I need to enter credentials?",
    answer:
      "No. The extension uses the browser session you already have open for Basecamp and EasySpeak — it never asks for a separate username or password.",
  },
  {
    question: "What happens when member names don't match?",
    answer:
      "The extension suggests a match based on name similarity and shows it to you for confirmation. Nothing is merged automatically without your review.",
  },
  {
    question: "Will I need to resolve the same match twice?",
    answer:
      "No — once you confirm or reject a match, that decision is saved and reused on every future report, even after re-extracting new data.",
  },
  {
    question: "Which EasySpeak deployments are supported?",
    answer:
      "All three regional EasySpeak servers: tmclub.eu (default), toastmasterclub.org, and easy-speak.org. You choose yours during setup.",
  },
];
