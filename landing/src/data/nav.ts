export interface NavLink {
  id: string;
  label: string;
}

export const navLinks: NavLink[] = [
  { id: "problem", label: "The Problem" },
  { id: "solution", label: "Solution" },
  { id: "screenshots", label: "Screenshots" },
  { id: "faq", label: "FAQ" },
  { id: "get-started", label: "Get Started" },
];
