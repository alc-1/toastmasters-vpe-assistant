export interface FaqItem {
  question: string;
  answer: string;
}

export const faqItems: FaqItem[] = [
  {
    question: "What is Toastmasters VPE Assistant?",
    answer:
      "A browser extension that consolidates member Pathways progress from Basecamp, EasySpeak, and Toastmasters.org Club Central into a single, reconciled report — so a VPE doesn't have to cross-check the systems by hand.",
  },
  {
    question: "Who is this for?",
    answer:
      "Toastmasters Vice Presidents of Education who track member Pathways progress across Basecamp, EasySpeak, and Club Central and want to stop reconciling them by hand.",
  },
  {
    question: "Do I need to enter credentials?",
    answer:
      "No. The extension uses the browser sessions you already have open for Basecamp, EasySpeak, and Club Central — it never asks for a separate username or password.",
  },
  {
    question: "What is the Pathways Onboarding Helper?",
    answer:
      "It reads your Club Central roster and lists paid-up members — plus members whose membership is still pending — who haven't enrolled in a Pathways path yet, grouped by club, so you know exactly who to reach out to.",
  },
  {
    question: "Can I export the report to a spreadsheet?",
    answer:
      "Yes. The extension can download an Excel workbook of member progress and path history, and you can choose to include everything or just Basecamp, EasySpeak, or Club Central data.",
  },
  {
    question: "Can I move my matching decisions to another computer?",
    answer:
      "Yes. Save or Restore Club Settings downloads a backup file of your data and confirmed match decisions that you can load back later — on a new machine, or after a browser reset.",
  },
  {
    question: "What happens when member names don't match?",
    answer:
      "The extension suggests a match based on name similarity and shows it to you for confirmation. Nothing is merged automatically without your review.",
  },
  {
    question: "Can I hide member names?",
    answer:
      "Yes. Privacy Mode masks member and club names on screen and in exports, and shows a clear indicator in the top bar while it's on.",
  },
  {
    question: "Which EasySpeak deployments are supported?",
    answer:
      "All three regional EasySpeak servers: tmclub.eu, toastmasterclub.org, and easy-speak.org. You choose yours during setup.",
  },
  {
    question: "Is FreeToastHost supported?",
    answer:
      "Not at the moment. Supporting FreeToastHost isn't currently planned in the short term, but it could be added further down the road if there is enough interest from VPEs and clubs using it.",
  },
  {
    question: "Who made this?",
    answer:
      "Alvaro Costa, a fellow Toastmaster at Lausanne International Toastmasters Club — see \"Built by a Toastmaster\" above for the full story.",
  },
  {
    question: "How can I provide feedback?",
    answer:
      "Use the extension and open a GitHub issue with bugs or feature ideas — that feedback is what shapes the roadmap.",
  },
];
