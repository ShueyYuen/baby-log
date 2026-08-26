import { ArrowLeft } from "lucide-react";
import { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "./ui";

interface SecondaryHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  backTo?: string;
  actions?: ReactNode;
}

export function SecondaryHeader({
  title,
  subtitle,
  onBack,
  backTo,
  actions,
}: SecondaryHeaderProps) {
  const navigate = useNavigate();

  return (
    <div className="border-b glass-sticky-header flex-shrink-0">
      <div className="flex items-center gap-3 px-4 md:px-8 py-3 max-w-4xl mx-auto w-full">
        {backTo ? (
          <Button variant="ghost" size="icon" asChild>
            <Link to={backTo}>
              <ArrowLeft size={20} />
            </Link>
          </Button>
        ) : (
          <Button variant="ghost" size="icon" onClick={onBack ?? (() => navigate(-1))}>
            <ArrowLeft size={20} />
          </Button>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold dark:text-gray-100 truncate">{title}</h2>
          {subtitle ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{subtitle}</p>
          ) : null}
        </div>
        {actions}
      </div>
    </div>
  );
}
