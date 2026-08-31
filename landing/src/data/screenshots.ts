import setupImg from "../assets/store_profile_selection.png";
import hubImg from "../assets/store_hub.png";
import clubProgressImg from "../assets/store_club_progress.png";
import onboardingImg from "../assets/store_onboarding_helper.png";

export interface Screenshot {
  id: string;
  title: string;
  caption: string;
  image: string;
}

export const screenshots: Screenshot[] = [
  {
    id: "setup",
    title: "Guided Setup",
    caption: "Pick your EasySpeak region and try it with demo data before connecting your real club.",
    image: setupImg,
  },
  {
    id: "home",
    title: "Your Home Screen",
    caption:
      "Club-data status at a glance, with a tile for every tool — and Privacy Mode plus your active profile always in the top bar.",
    image: hubImg,
  },
  {
    id: "club-progress",
    title: "Club Progress Report",
    caption:
      "See the level every member is working on now, who's ready to level up, and any mismatch between Basecamp and EasySpeak.",
    image: clubProgressImg,
  },
  {
    id: "onboarding-helper",
    title: "Pathways Onboarding Helper",
    caption:
      "Paid-up members who haven't started a Pathways path yet, grouped by club and split by payment status.",
    image: onboardingImg,
  },
];
