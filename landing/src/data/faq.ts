export interface FaqItem {
  question: string;
  answer: string;
}

export const faqItems: FaqItem[] = [
  {
    question: "What is Toastmasters VPE Assistant?",
    answer:
      "A Chrome extension that consolidates member Pathways progress from Basecamp and EasySpeak into a single, reconciled report — so a VPE doesn't have to cross-check the two systems by hand.",
  },
  {
    question: "Who is this for?",
    answer:
      "Toastmasters Vice Presidents of Education who track member Pathways progress across Basecamp and EasySpeak and want to stop reconciling the two by hand.",
  },
  {
    question: "Is it available now?",
    answer:
      "Yes. The Stable version is available on the Chrome Web Store today, and a Preview channel is open for anyone who wants the latest builds.",
  },
  {
    question: "What is the difference between Stable and Preview?",
    answer:
      "The Stable version is the latest reviewed Chrome Web Store release. Preview builds are made available earlier so we can iterate and gather feedback without waiting for Chrome Web Store review.",
  },
  {
    question: "Why is Preview ahead of the Chrome Web Store version?",
    answer:
      "Chrome Web Store releases go through a review process. To keep development moving quickly, new versions are first made available to Preview testers, then submitted to the Chrome Web Store once they're ready.",
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
      "Join the Preview Program and open a GitHub issue with bugs or feature ideas — that feedback is what shapes the roadmap.",
  },
];
