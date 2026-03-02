import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileQuestion } from "lucide-react";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <FileQuestion className="mx-auto h-16 w-16 text-muted-foreground/40" />
      <h1 className="mt-4 text-2xl font-bold">Page Not Found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <button
        type="button"
        onClick={() => navigate("/")}
        className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Modules
      </button>
    </div>
  );
}
