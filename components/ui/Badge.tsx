import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "success" | "warning" | "danger" | "info" | "purple";
}

const variants = {
  default: "bg-dark-700 text-dark-300 border border-dark-600",
  success: "bg-emerald-900/30 text-emerald-400 border border-emerald-800/60",
  warning: "bg-yellow-900/30 text-yellow-400 border border-yellow-800/60",
  danger: "bg-red-900/30 text-red-400 border border-red-800/60",
  info: "bg-blue-900/30 text-blue-400 border border-blue-800/60",
  purple: "bg-purple-900/30 text-purple-400 border border-purple-800/60",
};

export default function Badge({ children, className, variant = "default" }: BadgeProps) {
  return (
    <span className={cn("badge", variants[variant], className)}>
      {children}
    </span>
  );
}
