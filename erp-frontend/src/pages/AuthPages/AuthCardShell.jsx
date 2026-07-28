import { CardContent, CardHeader } from "@/components/ui/card";
import { Link } from "react-router-dom";

/**
 * Shared centered-card shell for the secondary auth pages
 * (forgot / reset / activate). Matches the app theme tokens.
 */
export default function AuthCardShell({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/40">
      <div className="w-full max-w-md py-8 px-5 rounded-2xl border bg-white/80 dark:bg-zinc-900 backdrop-blur-sm shadow-xl">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-3">
            <img src="/logo.png" alt="Consort Group" className="w-12 object-contain" />
          </div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </CardHeader>

        <CardContent className="space-y-6">{children}</CardContent>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          {footer ?? (
            <Link to="/" className="text-primary hover:underline">
              Back to sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
