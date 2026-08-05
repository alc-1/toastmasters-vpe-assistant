import setupImg from "../assets/screenshot_sync_data.png";
import dashboardImg from "../assets/screenshot_club_progress.png";
import discrepancyImg from "../assets/screenshot_club_progress_detail.png";
import matchImg from "../assets/screenshot_member_review.png";

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
    id: "dashboard",
    title: "Unified Progress Dashboard",
    caption: "View every member's Pathways status in one place.",
    image: dashboardImg,
  },
  {
    id: "match-resolution",
    title: "Smart Match Resolution",
    caption: "Review uncertain matches once and let the extension remember.",
    image: matchImg,
  },
  {
    id: "discrepancy",
    title: "Discrepancy Detection",
    caption: "Catch differences between systems before they become problems.",
    image: discrepancyImg,
  },
];
