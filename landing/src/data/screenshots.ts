import setupImg from "../assets/screenshot_sync_data.png";
import dashboardImg from "../assets/screenshot_club_progress.png";
import memberProgressImg from "../assets/screenshot_club_progress_detail.png";
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
    caption: "Your club's Pathways progress in one view.",
    image: dashboardImg,
  },
  {
    id: "match-resolution",
    title: "Smart Match Resolution",
    caption: "Resolve uncertain matches once and remember your decisions.",
    image: matchImg,
  },
  {
    id: "member-progress",
    title: "Follow Member Progress",
    caption: "Get a clear picture of both Basecamp and EasySpeak in one place.",
    image: memberProgressImg,
  },
];
